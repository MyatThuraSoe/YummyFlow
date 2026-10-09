import { inngest } from ".";
import { NonRetriableError } from "inngest";
import { getIO } from "../lib/socket";
import { prisma } from "../lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

const aiActions = (action: string) => {
  getIO().emit("ai-action-updated", {
    action,
  });
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const aiMenuFeedbackAnalyzer = inngest.createFunction(
  {
    id: "ai-menu-feedback-analyzer",
    triggers: [{ event: "admin/generate.feedback" }],
  },
  async ({ event, step }) => {
    const { itemId } = event.data;

    if (!itemId) {
      throw new NonRetriableError("itemId is required");
    }

    // 1. Fetch ONE item
    const item = await step.run("fetch-item-feedback", async () => {
      try {
        aiActions("Fetching recent feedback for the menu item...");
        return await prisma.menuItem.findUnique({
          where: { id: itemId },
          include: {
            category: true,
            feedbacks: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        });
      } catch (error) {
        aiActions("Failed to fetch item feedback.");
        console.error("Error fetching menu item feedback:", error);
        throw new NonRetriableError("Failed to fetch menu item feedback");
      }
    });

    if (!item || item.feedbacks.length === 0) {
      throw new NonRetriableError("No feedback found for this item.");
    }

    // 2. Compute metrics
    const avgRating =
      item.feedbacks.reduce((acc, f) => acc + f.rating, 0) /
      item.feedbacks.length;

    const comments = item.feedbacks
      .map((f) => `(${f.rating} Stars): ${f.comment}`)
      .join(" | ");

    // 3. AI Analysis
    const aiResponse = await step.run("analyze-item", async () => {
      try {
        const model = genAI.getGenerativeModel({
          model: "gemini-3-flash-preview",
          generationConfig: { responseMimeType: "application/json" },
        });
        aiActions("Analyzing customer feedback with AI...");
        const prompt = `
                You are an expert executive chef and restaurant consultant.
                Menu Item: "${item.name}" (Category: ${item.category.name})
                Average Rating: ${avgRating.toFixed(1)} out of 5.
                Recent Customer Comments: ${comments || "No written comments."}
        
                Task:
                1. If the Average Rating is high (>= 4.0), create a NEW spin-off product based on what they liked. Set "action" to "SPINOFF".
                2. If the Average Rating is low (<= 3.5), write an actionable improvement plan for the kitchen based on the complaints. Set "action" to "IMPROVE".
                3. If there isn't enough meaningful feedback, set "action" to "IGNORE".
        
                Respond STRICTLY in JSON:
                {
                  "action": "SPINOFF" | "IMPROVE" | "IGNORE",
                  "newName": "Name of spin-off dish (Only if SPINOFF)",
                  "output": "Recipe OR improvement plan"
                }
              `;

        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text().trim());
      } catch (error) {
        aiActions("AI analysis failed.");
        console.error("Error during AI analysis:", error);
        throw new NonRetriableError("AI analysis failed");
      }
    });

    // 4. Act on result
    await step.run("apply-ai-action", async () => {
      try {
        aiActions("Applying AI recommendations...");
        if (aiResponse.action === "IMPROVE") {
          aiActions("Applying improvement suggestions...");
          return prisma.menuItem.update({
            where: { id: item.id },
            data: { aiSuggestion: aiResponse.output },
          });
        }
        if (aiResponse.action === "SPINOFF") {
          aiActions("Creating new spin-off dish...");
          return prisma.menuItem.create({
            data: {
              name: aiResponse.newName,
              recipe: aiResponse.output,
              price: item.price,
              categoryId: item.categoryId,
              isAvailable: false,
            },
          });
        }
        aiActions("Done processing AI recommendations.");
        getIO().emit("menu-updated");
        return "Applied";
      } catch (error) {
        aiActions("Failed to apply AI recommendations.");
        console.error("Error applying AI recommendations:", error);
        throw new NonRetriableError("Failed to apply AI recommendations");
      }
    });

    return { message: `Processed item ${item.name}` };
  },
);

export const aiMenuItemGenerator = inngest.createFunction(
  {
    id: "ai-menu-item-generator",
    triggers: [{ event: "admin/generate.menu-item" }],
  },
  async ({ step }) => {
    try {
      // 1. Find the most ordered item in the database
      const topItemStats = await step.run("get-top-ordered-item", async () => {
        aiActions("Finding top-selling menu item...");
        const topItems = await prisma.orderItem.groupBy({
          by: ["menuItemId"],
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 1,
        });
        return topItems[0];
      });

      if (!topItemStats) {
        return { message: "No orders found in the database yet." };
      }

      // 2. Fetch the full details of the original top-selling item
      const originalItem = await step.run("get-original-item", async () => {
        aiActions("Fetching details of the top-selling item...");
        return await prisma.menuItem.findUnique({
          where: { id: topItemStats.menuItemId },
          include: { category: true },
        });
      });

      if (!originalItem) return { message: "Original menu item not found." };

      // 3. Ask Gemini to invent a NEW item (Force JSON response)
      const aiResponse = await step.run(
        "generate-gemini-new-item",
        async () => {
          aiActions("Asking Gemini to invent a new spin-off recipe...");
          const model = genAI.getGenerativeModel({
            model: "gemini-3-flash-preview",
            // Force Gemini to return a clean JSON object we can parse in Node.js
            generationConfig: { responseMimeType: "application/json" },
          });

          const prompt = `
          You are an expert executive chef in a high-end restaurant in Kenya.
          Our current best-selling menu item is "${originalItem.name}" (Category: ${originalItem.category.name}).
          
          Task 1: Determine if this item is a generic branded product (like "Coca-Cola", "Sprite", "Bottled Water"). If it is, we cannot make a recipe for it. Set "isValid" to false.
          
          Task 2: If it IS a valid food or craft beverage, invent a brand new, elevated, or creative spin-off version of this dish to add to our menu. 
          
          Return the response STRICTLY as a JSON object with the following structure:
          {
            "isValid": boolean,
            "newName": "The name of the new spin-off dish",
            "recipe": "A professional, step-by-step restaurant-grade recipe formatted in Markdown (using ### Ingredients and ### Instructions)."
          }
        `;

          const result = await model.generateContent(prompt);
          const text = result.response.text().trim();

          // Parse the JSON string returned by Gemini
          return JSON.parse(text) as {
            isValid: boolean;
            newName: string;
            recipe: string;
          };
        },
      );

      // 5. CREATE the brand new item in the database
      const newItem = await step.run("save-new-item-to-db", async () => {
        aiActions("Saving the new spin-off recipe to the database...");
        return await prisma.menuItem.create({
          data: {
            name: aiResponse.newName,
            recipe: aiResponse.recipe,
            price: originalItem.price, // Inherit the exact price of the original item
            categoryId: originalItem.categoryId, // Put it in the exact same category
            isAvailable: false, // Draft mode! Admin must review it first.
          },
        });
      });
      aiActions("All Done");
      getIO().emit("menu-updated");
      return {
        message: "New menu item successfully generated and saved as a draft!",
        originalItem: originalItem.name,
        newItemName: newItem.name,
      };
    } catch (error) {
      aiActions("Failed to generate new menu item.");
      console.error("Error generating new menu item:", error);
      throw new NonRetriableError("Failed to generate new menu item");
    }
  },
);

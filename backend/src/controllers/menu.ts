import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";
import { inngest } from "../inngest";

// create
export const createMenu = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      price,
      categoryId,
      isAvailable,
      discount,
      image,
    } = req.body;

    if (!name || !price || !categoryId) {
      return res
        .status(400)
        .json({ message: "Name, price, and categoryId are required" });
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const newMenuItem = await prisma.menuItem.create({
      data: {
        name,
        description,
        price,
        categoryId,
        isAvailable,
        image,
        discount,
      },
    });
    getIO().emit("menu-updated");
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "CREATE_MENU_ITEM",
      details: `Menu item created: ${newMenuItem.name}`,
    });
    res.status(201).json(newMenuItem);
  } catch (error) {
    console.error("Error creating menu:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// update
export const updateMenuItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const {
      name,
      description,
      price,
      categoryId,
      isAvailable,
      discount,
      image,
    } = req.body;

    const updatedMenuItem = await prisma.menuItem.update({
      where: {
        id,
      },
      data: {
        name: name?.trim(),
        description: description,
        price,
        categoryId,
        isAvailable,
        image,
        discount,
      },
    });
    getIO().emit("menu-updated");
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "UPDATE_MENU_ITEM",
      details: `Menu item updated: ${updatedMenuItem.name}`,
    });

    // 3. Return the updated menu item
    res.status(200).json({
      message: "Menu item updated successfully",
      data: updatedMenuItem,
    });
  } catch (error) {
    console.error("Error updating menu item:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// get by id
export const getMenuItemById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const menuItem = await prisma.menuItem.findUnique({
      where: { id },
      // only if we want to use category info in the response, otherwise we can remove the include
      include: {
        category: true,
      },
    });
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    res.status(200).json(menuItem);
  } catch (error) {
    console.error("Error getting menu item by id:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// delete
export const deleteMenuItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    await prisma.menuItem.delete({
      where: {
        id,
      },
    });
    getIO().emit("menu-updated");
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "DELETE_MENU_ITEM",
      details: `Menu item deleted: ${req.params.id}`,
    });
    res.status(200).json({ message: "Menu item deleted successfully" });
  } catch (error) {
    console.error("Error deleting menu item:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// get all menu items with pagination
export const getMenuItems = async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    // The shared WHERE clause so the count matches the data
    const whereClause = {
      isAvailable: session?.user?.role === "ADMIN" ? undefined : true,
    };

    const [rawMenuItems, totalItems] = await Promise.all([
      prisma.menuItem.findMany({
        skip: skip,
        take: limit,
        orderBy: { name: "asc" },
        where: whereClause,
        include: {
          // OPTIMIZATION: Only fetch the rating number to save server memory!
          feedbacks: {
            select: {
              rating: true,
              comment: true, // Optional: Include comment if you want to show it in the UI
            },
          },
        },
      }),
      // Added whereClause to count so pagination math is accurate
      prisma.menuItem.count({ where: whereClause }),
    ]);

    // MAP OVER ITEMS: Calculate the average rating for each item
    const menuItemsWithRatings = rawMenuItems.map((item) => {
      // Calculate average
      const totalRatings = item.feedbacks.reduce((sum, f) => sum + f.rating, 0);
      const averageRating =
        item.feedbacks.length > 0 ? totalRatings / item.feedbacks.length : 0;

      // Extract feedbacks out so we don't send useless arrays to the frontend
      const { feedbacks, ...itemData } = item;

      return {
        ...itemData,
        averageRating: Number(averageRating.toFixed(1)), // Rounds to 1 decimal place (e.g., 4.5)
        totalReviews: item.feedbacks.length, // Bonus: Good for the UI to say "4.5 stars (12 reviews)"
        feedbacks: item.feedbacks, // Include feedbacks in the response
      };
    });

    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      data: menuItemsWithRatings, // Sending the mapped data!
      totalItems,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.log("Error getting menu items:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// smart menu generation using AI
export const smartMenu = async (req: Request, res: Response) => {
  try {
    // This tells Inngest to instantly put the job in the background queue
    await inngest.send({
      name: "admin/generate.feedback", // This is the name of the function we want to trigger
      data: {
        itemId: req.body.itemId, // We can pass any data we want here, it will be available in the function
      },
    });
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "GENERATE_FEEDBACK",
      details: `AI feedback generation started in the background!`,
    });
    res
      .status(200)
      .json({ message: "AI Feedback generation started in the background!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to trigger AI" });
  }
};

// generate menu item using AI
export const generateMenuItem = async (req: Request, res: Response) => {
  try {
    // This tells Inngest to instantly put the job in the background queue
    await inngest.send({
      name: "admin/generate.menu-item", // This is the name of the function we want to trigger
      data: {}, // You can pass specific item IDs here if you want to generate recipes for specific items later!
    });
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "GENERATE_MENU_ITEM",
      details: `AI menu item generation started in the background!`,
    });
    res
      .status(200)
      .json({ message: "AI Menu Item generation started in the background!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to trigger AI" });
  }
};

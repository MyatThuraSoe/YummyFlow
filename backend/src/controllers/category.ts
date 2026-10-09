import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { activitiesLog } from "../lib/activities-log";

// create category
export const createCategory = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    const checkExisting = await prisma.category.findUnique({
      where: { name },
    });
    if (checkExisting) {
      return res.status(400).json({ message: "Category already exists" });
    }
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const newCategory = await prisma.category.create({
      data: { name, slug },
    });
    await activitiesLog({
      action: "CREATE_CATEGORY",
      userId: (req as any).user?.id,
      details: `Category created: ${newCategory.name}`,
    });
    res.status(201).json(newCategory);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// update category
export const updateCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    const checkExisting = await prisma.category.findUnique({
      where: { name },
    });
    if (checkExisting && checkExisting.id !== id) {
      return res.status(400).json({ message: "Category already exists" });
    }
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const updatedCategory = await prisma.category.update({
      where: { id },
      data: { name, slug },
    });
    await activitiesLog({
      action: "UPDATE_CATEGORY",
      userId: (req as any).user?.id,
      details: `Category updated: ${updatedCategory.name}`,
    });
    res.status(200).json(updatedCategory);
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// delete category
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!id) {
      return res.status(400).json({ message: "Category ID is required" });
    }
    await prisma.category.delete({
      where: { id },
    });
    await activitiesLog({
      action: "DELETE_CATEGORY",
      userId: (req as any).user?.id,
      details: `Category deleted: ${id}`,
    });
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// get all categories
export const getCategories = async (req: Request, res: Response) => {
  try {
    // 1. Parse query parameters with defaults (page 1, limit 10)
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);

    // 2. Calculate how many records to skip
    const skip = (page - 1) * limit;

    // 3. Run the data fetch and total count concurrently for better performance
    const [categories, totalItems] = await Promise.all([
      prisma.category.findMany({
        skip: skip,
        take: limit,
        orderBy: {
          name: "asc", // Optional: order alphabetically or by createdAt
        },
      }),
      prisma.category.count(), // Gets the total number of categories in the DB
    ]);

    // 4. Calculate pagination metadata
    const totalPages = Math.ceil(totalItems / limit);

    // 5. Return structured response
    res.status(200).json({
      data: categories,
      totalItems,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

import * as z from "zod";

// name, description, price, categoryId, isAvailable, image
export const itemSchema = z.object({
  name: z
    .string()
    .min(5, "Name must be at least 5 characters.")
    .max(32, "Name must be at most 32 characters."),
  description: z.array(z.any()).optional(),
  price: z.coerce.number().min(0.01, "Price must be at least 0.01."),
  discount: z.coerce
    .number()
    .min(0, "Discount must be a positive number.")
    .optional(),
  categoryId: z.string().min(1, "Category is required."),
  isAvailable: z.boolean().default(true),
  image: z.string().optional(),
});

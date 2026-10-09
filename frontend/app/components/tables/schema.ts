import * as z from "zod";

// name, description, price, categoryId, isAvailable, image
export const tableSchema = z.object({
  name: z
    .string()
    .min(3, "Name must be at least 3 characters.")
    .max(32, "Name must be at most 32 characters."),
  seats: z.coerce.number().min(1, "Seats must be at least 1."),
  section: z
    .enum(["Main Dining Room", "Outdoor", "Terrace"])
    .default("Main Dining Room"),
  shape: z.enum(["square", "circle", "rectangle"]).default("square"),
});

export const SectionOptions = [
  { value: "Main Dining Room", label: "Main Dining Room" },
  { value: "Outdoor", label: "Outdoor" },
  { value: "Terrace", label: "Terrace" },
];
export const ShapeOptions = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "rectangle", label: "Rectangle" },
];

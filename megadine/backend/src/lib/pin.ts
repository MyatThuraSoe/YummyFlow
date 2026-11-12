import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";
import { pinLookup, pinValidationError } from "./auth.js";

/**
 * Validate a staff PIN and return its keyed lookup value. Uniqueness is scoped
 * to the restaurant so two people at the same counter cannot share a PIN.
 */
export async function pinForStorage(
  restaurantId: string,
  pin: string,
  excludeUserId?: string,
): Promise<string> {
  const error = pinValidationError(pin);
  if (error) throw ApiError.badRequest(error);
  const lookup = pinLookup(restaurantId, pin);
  const clash = await prisma.user.findFirst({
    where: {
      restaurantId,
      pinLookup: lookup,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "validation.duplicate.pin", "That PIN is already used by another staff member");
  return lookup;
}

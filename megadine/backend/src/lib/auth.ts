import bcrypt from "bcryptjs";
import { randomBytes, createHash, createHmac } from "node:crypto";
import { env } from "./env.js";

const PIN_ROUNDS = 10;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Opaque session token; only its SHA-256 hash is stored server-side. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/**
 * Keyed, one-way lookup value for a PIN. It lets the app enforce uniqueness per
 * restaurant without storing the PIN or an unsalted hash of it.
 */
export function pinLookup(restaurantId: string, pin: string): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`${restaurantId}:${pin}`)
    .digest("hex");
}

/** Reject the PINs a customer can guess across the counter. */
export function pinValidationError(pin: string): string | null {
  if (!isValidPinFormat(pin)) return "PIN must be 4-6 digits";
  if (/^(\d)\1+$/.test(pin)) return "PIN cannot be all the same digit";
  if (pin === "1234" || pin === "0123" || pin === "0000") return "Choose a less obvious PIN";
  return null;
}

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from backend root (src/lib -> ../../.env)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: num(process.env.PORT, 3001),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  SESSION_SECRET: process.env.SESSION_SECRET ?? "dev-insecure-secret",
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY ?? "USD",
  DEFAULT_TAX_RATE: num(process.env.DEFAULT_TAX_RATE, 0.085),
  DEFAULT_SERVICE_CHARGE: num(process.env.DEFAULT_SERVICE_CHARGE, 0),
  DEFAULT_BUSINESS_DAY_CUTOFF: process.env.DEFAULT_BUSINESS_DAY_CUTOFF ?? "04:00",
  PRINTER_MODE: process.env.PRINTER_MODE ?? "simulate",
  RECEIPT_PRINTER_IP: process.env.RECEIPT_PRINTER_IP ?? "",
  KITCHEN_PRINTER_IP: process.env.KITCHEN_PRINTER_IP ?? "",
  LICENSE_KEY: process.env.LICENSE_KEY ?? "",
  MEGACODE_LICENSE_PUBLIC_KEY: process.env.MEGACODE_LICENSE_PUBLIC_KEY ?? "",
  // Pin the machine id explicitly (e.g. inside Docker) so the hardware-bound
  // license stays valid across container rebuilds.
  MACHINE_ID: process.env.MACHINE_ID ?? "",
  BACKUP_DIR: process.env.BACKUP_DIR ?? "./backups",
  BACKUP_RETENTION_DAYS: num(process.env.BACKUP_RETENTION_DAYS, 30),
  USB_EXPORT_DIR: process.env.USB_EXPORT_DIR ?? "",
  SESSION_TTL_HOURS: num(process.env.SESSION_TTL_HOURS, 12),
  MAX_PIN_ATTEMPTS: num(process.env.MAX_PIN_ATTEMPTS, 3),
  LOCKOUT_MINUTES: num(process.env.LOCKOUT_MINUTES, 5),
  // Set true only when serving over HTTPS; LAN installs run plain HTTP and a
  // Secure cookie would be dropped by the browser.
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, false),
  REDIS_URL: process.env.REDIS_URL ?? "",
};

export const isProd = env.NODE_ENV === "production";

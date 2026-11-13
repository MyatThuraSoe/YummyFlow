import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { initSocket } from "./lib/socket.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startNotificationSchedulers } from "./services/notifications.service.js";
import { startPrintWorker } from "./lib/printQueue.js";
import { prisma } from "./lib/prisma.js";
import { setRuntimeLicenseKey } from "./lib/license.js";
import { setBusinessTimezone } from "./lib/businessDay.js";
import { verifyPin } from "./lib/auth.js";

const app = createApp();
const server = http.createServer(app);
initSocket(server);

/** PINs shipped by the demo seed; production must not keep any of them. */
const DEMO_PINS = ["0000", "4444", "1111", "2222", "3333"];
const WEAK_SECRETS = ["change-me", "dev-insecure", "dev-local", "secret"];

/**
 * Refuse to start a production install that still uses demo credentials.
 * A shipped SESSION_SECRET or a 4-digit demo PIN is a public password.
 */
async function assertProductionSafety() {
  if (env.NODE_ENV !== "production") return;

  const secret = env.SESSION_SECRET;
  const weak =
    secret.length < 32 || WEAK_SECRETS.some((s) => secret.toLowerCase().includes(s));
  if (weak) {
    throw new Error(
      "SESSION_SECRET is missing, too short or still a placeholder. Set a long random value before starting in production.",
    );
  }

  const users = await prisma.user.findMany({
    where: { pinHash: { not: null }, deletedAt: null },
    select: { id: true, name: true, pinHash: true },
  });
  for (const user of users) {
    if (!user.pinHash) continue;
    for (const pin of DEMO_PINS) {
      if (await verifyPin(pin, user.pinHash)) {
        throw new Error(
          `User "${user.name}" still uses a demo PIN (${pin}). Rotate every PIN before starting in production.`,
        );
      }
    }
  }
}

/** Load the restaurant time zone once so date maths is right from first request. */
async function loadBusinessTimezone() {
  try {
    const restaurant = await prisma.restaurant.findFirst({
      select: { timezone: true, licenseKey: true },
      orderBy: { createdAt: "asc" },
    });
    if (restaurant?.timezone) {
      setBusinessTimezone(restaurant.timezone);
      console.log(`  timezone: ${restaurant.timezone}`);
    }
    if (restaurant?.licenseKey) {
      // Prefer a license key persisted via the activation API over the env var
      // (PRD platform §7.1). Failures are non-fatal: we keep the env key.
      setRuntimeLicenseKey(restaurant.licenseKey);
      console.log("  license: loaded from database");
    }
  } catch (err) {
    console.warn("[startup] could not load restaurant settings", err);
  }
}

async function bootstrap() {
  await loadBusinessTimezone();
  await assertProductionSafety();

  if (env.NODE_ENV !== "test") {
    startScheduler();
    startNotificationSchedulers();
    startPrintWorker();
  }

  server.listen(env.PORT, () => {
    console.log(`\nMegaDine POS backend listening on http://localhost:${env.PORT}`);
    console.log(`  health:  http://localhost:${env.PORT}/health`);
    console.log(`  api:     http://localhost:${env.PORT}/api/v1`);
    console.log(`  printer: ${env.PRINTER_MODE} (receipt=${env.RECEIPT_PRINTER_IP || "sim"}, kitchen=${env.KITCHEN_PRINTER_IP || "sim"})\n`);
  });
}

bootstrap().catch((err) => {
  console.error("[startup] refusing to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});

const shutdown = () => {
  console.log("Shutting down...");
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

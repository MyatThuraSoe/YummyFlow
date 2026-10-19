import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { initSocket } from "./lib/socket.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startNotificationSchedulers } from "./services/notifications.service.js";
import { prisma } from "./lib/prisma.js";
import { setRuntimeLicenseKey } from "./lib/license.js";

const app = createApp();
const server = http.createServer(app);
initSocket(server);

if (env.NODE_ENV !== "test") {
  startScheduler();
  startNotificationSchedulers();
}

// Prefer a license key persisted via the activation API over the env var
// (PRD platform §7.1). Failures are non-fatal: we simply keep the env key.
prisma.restaurant
  .findFirst({ select: { licenseKey: true }, orderBy: { createdAt: "asc" } })
  .then((r) => {
    if (r?.licenseKey) {
      setRuntimeLicenseKey(r.licenseKey);
      console.log("  license: loaded from database");
    }
  })
  .catch(() => {});

server.listen(env.PORT, () => {
  console.log(`\nMegaDine POS backend listening on http://localhost:${env.PORT}`);
  console.log(`  health:  http://localhost:${env.PORT}/health`);
  console.log(`  api:     http://localhost:${env.PORT}/api/v1`);
  console.log(`  printer: ${env.PRINTER_MODE} (receipt=${env.RECEIPT_PRINTER_IP || "sim"}, kitchen=${env.KITCHEN_PRINTER_IP || "sim"})\n`);
});

const shutdown = () => {
  console.log("Shutting down...");
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

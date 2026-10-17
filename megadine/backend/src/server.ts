import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { initSocket } from "./lib/socket.js";
import { startScheduler } from "./jobs/scheduler.js";

const app = createApp();
const server = http.createServer(app);
initSocket(server);

if (env.NODE_ENV !== "test") startScheduler();

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

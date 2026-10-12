import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { attachAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { authRouter } from "./routes/auth.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { menuRouter } from "./routes/menu.routes.js";
import { tablesRouter } from "./routes/tables.routes.js";
import { kitchenRouter } from "./routes/kitchen.routes.js";
import { paymentsRouter } from "./routes/payments.routes.js";
import { shiftsRouter } from "./routes/shifts.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { inventoryRouter } from "./routes/inventory.routes.js";
import { expensesRouter } from "./routes/expenses.routes.js";
import { adminRouter } from "./routes/admin.routes.js";

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  if (env.NODE_ENV !== "test") app.use(morgan("tiny"));
  // Global DoS throttling (PRD §10.2): loose per-IP cap over all routes. The
  // auth routes apply their own stricter limiter on top.
  const globalLimiter = rateLimit({ windowMs: 60_000, max: 1200, key: "global" });
  app.use((req, res, next) => (req.path === "/health" ? next() : globalLimiter(req, res, next)));
  app.use(attachAuth);

  app.get("/health", (_req, res) => res.json({ ok: true, name: "megadine-pos", time: new Date().toISOString() }));

  const v1 = express.Router();
  v1.use("/auth", authRouter);
  v1.use("/orders", ordersRouter);
  v1.use("/menu", menuRouter);
  v1.use("/tables", tablesRouter);
  v1.use("/kitchen", kitchenRouter);
  v1.use("/payments", paymentsRouter);
  v1.use("/shifts", shiftsRouter);
  v1.use("/reports", reportsRouter);
  v1.use("/inventory", inventoryRouter);
  v1.use("/expenses", expensesRouter);
  v1.use("/admin", adminRouter);
  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

import dotenv from "dotenv";
import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import morgan from "morgan";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createServer } from "http";
import { serve } from "inngest/express";

import { auth } from "./lib/auth";
import categoryRouter from "./routes/category";
import activitiesLogRouter from "./routes/activities-log";
import menuItemRouter from "./routes/menu";
import tableRouter from "./routes/table";
import reservationRouter from "./routes/reservation";
import { edgestoreHandler } from "./lib/edgestore";
import orderRouter from "./routes/order";
import { getIO, initSocket } from "./lib/socket";
import { inngest } from "./inngest";
import {
  aiMenuFeedbackAnalyzer,
  aiMenuItemGenerator,
} from "./inngest/function";
import {
  aiDailyExecutiveBriefing,
  aiOnDemandBriefing,
  aiWeeklyDemandForecast,
} from "./inngest/briefing";
import dashboardRouter from "./routes/dashboard";
import notificationRouter from "./routes/notifications";
import briefingRouter from "./routes/briefing";
import reportRouter from "./routes/reports";
import waitlistRouter from "./routes/waitlist";
import inventoryRouter from "./routes/inventory";
import { requireAuth } from "./middleware/requireAuth";
import { requirePermission } from "./middleware/requirePermission";

dotenv.config();
const app: Application = express();
const PORT = process.env.PORT || 5000;
// Create HTTP Server
const httpServer = createServer(app);

//  Initialize Socket.IO globally 👈
initSocket(httpServer);

// Make 'io' accessible in Express req.app.get("io") for backwards compatibility
app.set("io", getIO());

// Middleware => security, parsing, etc.
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// better-auth
app.all("/api/auth/*splat", toNodeHandler(auth));

// parsing
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json());

// logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Menu image storage (EdgeStore).
//
// These handlers were mounted with no auth at all on an unprotected bucket, so
// any anonymous client could mint signed upload URLs, DELETE menu images, and
// call `/edgestore/proxy-file?url=…`, which fetches an arbitrary URL server-side
// — an unauthenticated SSRF into the private network (cloud metadata at
// 169.254.169.254, the local Mongo replica set, anything else the host can
// reach). Gating behind the same permission that already guards menu writes
// closes all of it.
app.get(
  "/edgestore/*splat",
  requireAuth,
  requirePermission("create", "menu"),
  edgestoreHandler,
);
app.post(
  "/edgestore/*splat",
  requireAuth,
  requirePermission("create", "menu"),
  edgestoreHandler,
);

app.use("/api/dashboard", dashboardRouter);
app.use("/api/category", categoryRouter);
app.use("/api/activities-log", activitiesLogRouter);
app.use("/api/menu", menuItemRouter);
app.use("/api/tables", tableRouter);
app.use("/api/reservations", reservationRouter);
app.use("/api/orders", orderRouter);
// Service-day close / Z report
app.use("/api/reports", reportRouter);
// PRO: email + browser push notifications
app.use("/api/notifications", notificationRouter);
// PRO: AI briefings (executive digest + demand forecast)
app.use("/api/briefings", briefingRouter);
// Walk-in queue — two of its routes are public, see routes/waitlist.ts
app.use("/api/waitlist", waitlistRouter);
// Store management: ingredients, recipes, stock ledger
app.use("/api/inventory", inventoryRouter);
app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [
      aiMenuFeedbackAnalyzer,
      aiMenuItemGenerator,
      aiDailyExecutiveBriefing,
      aiWeeklyDemandForecast,
      aiOnDemandBriefing,
    ],
  }),
);

app.get("/", (req: Request, res: Response) => {
  res.send("Hello from the backend!");
});

// test better-auth route
app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  res.status(200).json({ session });
});

// Global error handler.
//
// The stack trace is gated on a hard production check rather than NODE_ENV.
// `.env` ships NODE_ENV=development, so a deployment that copies it verbatim
// leaked every route's file paths, module layout and internal error text to any
// caller who could provoke a 500.
app.use((err: any, req: Request, res: Response, next: any) => {
  const isProduction = process.env.NODE_ENV === "production";
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  if (!isProduction) {
    console.error("Unhandled error:", err);
  }

  res.status(statusCode).json({
    message: isProduction ? "Internal server error" : err.message,
    stack: isProduction ? undefined : err.stack,
  });
});

// Start the server
httpServer.listen(PORT, () => {
  console.log(`⚡Server is running on http://localhost:${PORT}`);
});

import express from "express";
import {
  getVapidPublicKey,
  getNotificationStatus,
  subscribe,
  unsubscribe,
  sendTestNotification,
  sendTestEmail,
  getNotificationLog,
  pingSelf,
} from "../controllers/notification";
import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";

const notificationRouter = express.Router();

// Public — the browser needs the VAPID key before it can subscribe.
notificationRouter.get("/public-key", getVapidPublicKey);

// Per-user device registration
notificationRouter.get("/status", requireAuth, getNotificationStatus);
notificationRouter.post("/subscribe", requireAuth, subscribe);
notificationRouter.post("/unsubscribe", requireAuth, unsubscribe);
notificationRouter.post("/test", requireAuth, sendTestNotification);
notificationRouter.post("/ping", requireAuth, pingSelf);

// Operational visibility for management
notificationRouter.get(
  "/log",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getNotificationLog,
);
notificationRouter.post(
  "/test-email",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  sendTestEmail,
);

export default notificationRouter;

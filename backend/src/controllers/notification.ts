import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getPublicKey, pushEnabled, sendTestToUser, sendToUser } from "../lib/push";
import { isSmtpConfigured, verifyMailer } from "../lib/mailer";
import { sendMail } from "../lib/mailer";
import { testEmail } from "../emails/templates";

/** Public: the browser needs this key before it can subscribe. */
export const getVapidPublicKey = (_req: Request, res: Response) => {
  res.status(200).json({
    publicKey: getPublicKey(),
    pushEnabled,
    smtpConfigured: isSmtpConfigured,
  });
};

/** Auth: is this user set up for push on any device? */
export const getNotificationStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const subscriptions = await prisma.pushSubscription.count({ where: { userId } });
    res.status(200).json({
      pushEnabled,
      smtpConfigured: isSmtpConfigured,
      publicKey: getPublicKey(),
      subscriptions,
    });
  } catch (error) {
    console.error("Notification status error:", error);
    res.status(500).json({ error: "Failed to read notification status" });
  }
};

/**
 * Auth: persist a browser PushSubscription.
 * `endpoint` is unique, so re-subscribing on the same browser updates in place
 * (and re-points it at the current user if the device changed accounts).
 */
export const subscribe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { endpoint, keys } = req.body ?? {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({
        error: "Invalid subscription: endpoint, keys.p256dh and keys.auth are required",
      });
    }

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
        userAgent: req.headers["user-agent"] ?? null,
      },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });

    res.status(201).json({ success: true, id: sub.id });
  } catch (error) {
    console.error("Push subscribe error:", error);
    res.status(500).json({ error: "Failed to save push subscription" });
  }
};

export const unsubscribe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { endpoint } = req.body ?? {};

    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    } else {
      // No endpoint given: drop every device for this user.
      await prisma.pushSubscription.deleteMany({ where: { userId } });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
};

/** Auth: fire a test push + test email at the caller so they can verify setup. */
export const sendTestNotification = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: string; email: string };

    const push = await sendTestToUser(user.id);

    const rendered = testEmail({
      mode: isSmtpConfigured ? "smtp" : "outbox",
      appUrl: process.env.CLIENT_URL || "http://localhost:5173",
    });
    const mail = await sendMail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      template: "test",
    });

    await prisma.notificationLog
      .create({
        data: {
          channel: "EMAIL",
          status: mail.ok ? "SENT" : "FAILED",
          template: "test",
          recipient: user.email,
          subject: rendered.subject,
          error: mail.ok ? undefined : mail.error,
          userId: user.id,
          meta: { preview: mail.ok ? mail.preview ?? null : null },
        },
      })
      .catch(() => {});

    res.status(200).json({
      push: {
        enabled: pushEnabled,
        sent: push.sent,
        failed: push.failed,
        skipped: push.skipped,
        hint: push.skipped
          ? pushEnabled
            ? "No browser is subscribed yet — enable notifications first."
            : "VAPID keys are not configured on the server."
          : undefined,
      },
      email: {
        mode: isSmtpConfigured ? "smtp" : "outbox",
        ok: mail.ok,
        preview: mail.ok ? mail.preview : undefined,
        error: mail.ok ? undefined : mail.error,
      },
    });
  } catch (error) {
    console.error("Send test notification error:", error);
    res.status(500).json({ error: "Failed to send test notification" });
  }
};

/** Admin/Manager: recent delivery attempts across both channels. */
export const getNotificationLog = async (req: Request, res: Response) => {
  try {
    // Clamped at BOTH ends. `Math.min(x, 100)` alone let `?limit=-5` through as
    // `take: -5`, which Prisma rejects — so a negative limit 500'd.
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, 100));
    const channel = req.query.channel as "EMAIL" | "PUSH" | undefined;

    const [logs, emailSent, pushSent, failed] = await Promise.all([
      prisma.notificationLog.findMany({
        where: channel ? { channel } : {},
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notificationLog.count({ where: { channel: "EMAIL", status: "SENT" } }),
      prisma.notificationLog.count({ where: { channel: "PUSH", status: "SENT" } }),
      prisma.notificationLog.count({ where: { status: "FAILED" } }),
    ]);

    res.status(200).json({
      data: logs,
      totals: { emailSent, pushSent, failed },
    });
  } catch (error) {
    console.error("Notification log error:", error);
    res.status(500).json({ error: "Failed to read notification log" });
  }
};

/** Admin: health-check the mailer and optionally send to a specific address. */
export const sendTestEmail = async (req: Request, res: Response) => {
  try {
    const to = (req.body?.to as string) || ((req as any).user?.email as string);
    if (!to) return res.status(400).json({ error: "Recipient email is required" });

    const health = await verifyMailer();
    const rendered = testEmail({
      mode: health.mode,
      appUrl: process.env.CLIENT_URL || "http://localhost:5173",
    });

    const mail = await sendMail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      template: "test",
    });

    await prisma.notificationLog
      .create({
        data: {
          channel: "EMAIL",
          status: mail.ok ? "SENT" : "FAILED",
          template: "test",
          recipient: to,
          subject: rendered.subject,
          error: mail.ok ? undefined : mail.error,
          userId: (req as any).user?.id,
          meta: { preview: mail.ok ? mail.preview ?? null : null },
        },
      })
      .catch(() => {});

    res.status(200).json({
      transport: health,
      delivery: { ok: mail.ok, preview: mail.ok ? mail.preview : undefined, error: mail.ok ? undefined : mail.error },
    });
  } catch (error) {
    console.error("Send test email error:", error);
    res.status(500).json({ error: "Failed to send test email" });
  }
};

/** Auth: re-send any notification to this user's own devices (used by the UI bell). */
export const pingSelf = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const outcome = await sendToUser(userId, {
      title: "DineFlow",
      body: "This is a ping from your dashboard.",
      url: "/dashboard",
      tag: "dineflow-ping",
      template: "ping",
    });
    res.status(200).json(outcome);
  } catch (error) {
    console.error("Ping error:", error);
    res.status(500).json({ error: "Failed to send ping" });
  }
};

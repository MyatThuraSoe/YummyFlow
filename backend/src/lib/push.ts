import "dotenv/config";
import webpush from "web-push";
import { prisma } from "./prisma";

/**
 * Browser push (VAPID) delivery.
 *
 * Keys are generated once at setup and stored in the backend .env:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (backend -> signs & sends)
 *   VITE_VAPID_PUBLIC_KEY                 (frontend -> subscribe, same public key)
 *
 * If the keys are absent the module degrades to a no-op that still writes a
 * NotificationLog row with status SKIPPED, so the feature is observable rather
 * than silently broken.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@dineflow.local";

export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (pushEnabled) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);
    console.log("[push] VAPID configured — browser push is enabled");
  } catch (error: any) {
    console.error("[push] invalid VAPID configuration:", error?.message);
  }
} else {
  console.warn(
    "[push] VAPID keys missing — push notifications will be logged as SKIPPED.\n" +
      "       Generate keys with: node -e \"console.log(require('web-push').generateVAPIDKeys())\"",
  );
}

export const getPublicKey = () => PUBLIC_KEY ?? null;

export type PushPayload = {
  title: string;
  body: string;
  /** Deep link opened when the notification is clicked. */
  url?: string;
  /** Collapses notifications that share a tag. */
  tag?: string;
  /** Label used for the NotificationLog row. */
  template: string;
};

type PushOutcome = { sent: number; failed: number; skipped: boolean };

function logPush(
  status: "SENT" | "FAILED" | "SKIPPED",
  payload: PushPayload,
  recipient: string,
  error?: string,
  userId?: string | null,
) {
  return prisma.notificationLog
    .create({
      data: {
        channel: "PUSH",
        status,
        template: payload.template,
        recipient,
        subject: payload.title,
        error,
        userId: userId ?? undefined,
        meta: { url: payload.url ?? "/", tag: payload.tag ?? null },
      },
    })
    .catch((e) => console.error("[push] failed to write NotificationLog:", e?.message));
}

/** Sends to every device registered to one user. Prunes dead endpoints. */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushOutcome> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });

  if (subs.length === 0) {
    await logPush("SKIPPED", payload, userId, "no subscriptions", userId);
    return { sent: 0, failed: 0, skipped: true };
  }
  if (!pushEnabled) {
    await logPush("SKIPPED", payload, userId, "VAPID not configured", userId);
    return { sent: 0, failed: 0, skipped: true };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag,
  });

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent++;
      } catch (error: any) {
        failed++;
        const code = error?.statusCode;
        // 404 / 410 mean the browser threw the subscription away.
        if (code === 404 || code === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
          await logPush("FAILED", payload, sub.endpoint, `stale subscription (${code}) removed`, userId);
        } else {
          await logPush("FAILED", payload, sub.endpoint, error?.message ?? "send failed", userId);
        }
      }
    }),
  );

  if (sent > 0) await logPush("SENT", payload, userId, undefined, userId);
  console.log(`[push] "${payload.title}" -> user ${userId}: ${sent} sent, ${failed} failed`);
  return { sent, failed, skipped: false };
}

/** Fan-out to several users (de-duplicated). */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<PushOutcome> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const results = await Promise.all(unique.map((id) => sendToUser(id, payload)));
  return {
    sent: results.reduce((a, r) => a + r.sent, 0),
    failed: results.reduce((a, r) => a + r.failed, 0),
    skipped: results.every((r) => r.skipped),
  };
}

/**
 * Broadcast to every user holding one of the given roles.
 * Used for "new order" -> ADMIN/MANAGER/STAFF/KITCHEN.
 */
export async function sendToRoles(
  roles: Array<"ADMIN" | "MANAGER" | "STAFF" | "KITCHEN" | "CUSTOMER">,
  payload: PushPayload,
): Promise<PushOutcome> {
  const users = await prisma.user.findMany({
    where: { role: { in: roles }, banned: false },
    select: { id: true },
  });
  return sendToUsers(
    users.map((u) => u.id),
    payload,
  );
}

/** Used by the admin "send test notification" action. */
export async function sendTestToUser(userId: string): Promise<PushOutcome> {
  return sendToUser(userId, {
    title: "DineFlow test notification",
    body: "Push notifications are working on this device.",
    url: "/dashboard",
    tag: "dineflow-test",
    template: "push-test",
  });
}

import { prisma } from "./prisma";
import { sendMail } from "./mailer";
import { sendToUser, sendToRoles } from "./push";
import {
  welcomeEmail,
  orderReceiptEmail,
  reservationConfirmationEmail,
  reservationStatusEmail,
  accountStatusEmail,
  type RenderedEmail,
} from "../emails/templates";

/**
 * Notification orchestrator.
 *
 * Every public function here is *fire-and-forget safe*: it swallows and logs its
 * own errors so a mail/push failure can never break an order, booking or signup.
 * All attempts are recorded in NotificationLog for the admin delivery log.
 */

const APP_URL = process.env.CLIENT_URL || "http://localhost:5173";

type EmailArgs = {
  to: string;
  template: string;
  rendered: RenderedEmail;
  userId?: string | null;
  meta?: Record<string, unknown>;
};

async function deliverEmail({ to, template, rendered, userId, meta }: EmailArgs) {
  const result = await sendMail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    template,
  });

  try {
    await prisma.notificationLog.create({
      data: {
        channel: "EMAIL",
        status: result.ok ? "SENT" : "FAILED",
        template,
        recipient: to,
        subject: rendered.subject,
        error: result.ok ? undefined : result.error,
        userId: userId ?? undefined,
        meta: { ...(meta ?? {}), preview: result.ok ? result.preview ?? null : null },
      },
    });
  } catch (e: any) {
    console.error("[notify] failed to write NotificationLog:", e?.message);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Signup welcome                                                      */
/* ------------------------------------------------------------------ */

export async function notifyWelcome(user: {
  id: string;
  email: string;
  name?: string | null;
}) {
  try {
    await deliverEmail({
      to: user.email,
      template: "welcome",
      userId: user.id,
      rendered: welcomeEmail({ name: user.name || "there", appUrl: APP_URL }),
    });
  } catch (e: any) {
    console.error("[notify] welcome failed:", e?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Order receipt                                                       */
/* ------------------------------------------------------------------ */

export async function notifyOrderReceipt({
  orderId,
  guestEmail,
  guestName,
}: {
  orderId: string;
  guestEmail?: string | null;
  guestName?: string | null;
}) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        table: true,
        user: { select: { id: true, email: true, name: true } },
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });
    if (!order) return;

    const to = order.user?.email || guestEmail || null;
    if (!to) {
      // Walk-in POS order with no customer identity — nothing to send.
      await prisma.notificationLog
        .create({
          data: {
            channel: "EMAIL",
            status: "SKIPPED",
            template: "order-receipt",
            recipient: "(no customer email)",
            subject: `Receipt for order ${orderId.slice(-6)}`,
            error: "order has no associated customer email",
            userId: order.userId ?? undefined,
          },
        })
        .catch(() => {});
      return;
    }

    await deliverEmail({
      to,
      template: "order-receipt",
      userId: order.userId,
      meta: { orderId: order.id },
      rendered: orderReceiptEmail({
        customerName: order.user?.name || guestName || "Guest",
        orderId: order.id,
        orderType: order.orderType,
        tableName: order.table?.name ?? null,
        items: order.items.map((i) => ({
          name: i.menuItem?.name ?? "Item",
          quantity: i.quantity,
          price: i.price,
        })),
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
      }),
    });
  } catch (e: any) {
    console.error("[notify] order receipt failed:", e?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export async function notifyReservationCreated(reservationId: string) {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        table: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!r) return;

    // An address the guest typed in explicitly wins over the account email —
    // they may be booking on behalf of someone else.
    const to = r.email || r.user?.email || null;
    if (!to) return;

    await deliverEmail({
      to,
      template: "reservation-confirmation",
      userId: r.userId,
      meta: { reservationId: r.id },
      rendered: reservationConfirmationEmail({
        customerName: r.customerName || r.user?.name || "Guest",
        date: r.date,
        guests: r.guests,
        tableName: r.table?.name ?? "TBD",
        appUrl: `${APP_URL}/profile/${r.userId ?? ""}`,
      }),
    });
  } catch (e: any) {
    console.error("[notify] reservation confirmation failed:", e?.message);
  }
}

export async function notifyReservationStatus(
  reservationId: string,
  status: string,
) {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        table: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!r) return;

    // Same precedence as the confirmation email: explicit address first.
    const to = r.email || r.user?.email || null;
    if (!to) return;

    await deliverEmail({
      to,
      template: `reservation-${status.toLowerCase()}`,
      userId: r.userId,
      meta: { reservationId: r.id, status },
      rendered: reservationStatusEmail({
        customerName: r.customerName || r.user?.name || "Guest",
        status,
        date: r.date,
        guests: r.guests,
        tableName: r.table?.name ?? "TBD",
        appUrl: `${APP_URL}/profile/${r.userId ?? ""}`,
      }),
    });
  } catch (e: any) {
    console.error("[notify] reservation status failed:", e?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Account status                                                      */
/* ------------------------------------------------------------------ */

export async function notifyAccountStatus(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, banned: true, banReason: true },
    });
    if (!user) return;

    await deliverEmail({
      to: user.email,
      template: user.banned ? "account-suspended" : "account-restored",
      userId: user.id,
      rendered: accountStatusEmail({
        name: user.name || "there",
        banned: user.banned,
        reason: user.banReason,
        appUrl: APP_URL,
      }),
    });
  } catch (e: any) {
    console.error("[notify] account status failed:", e?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Push-only: operational alerts for staff                             */
/* ------------------------------------------------------------------ */

export async function pushNewOrder(order: {
  id: string;
  orderType: string;
  totalAmount: number;
  tableName?: string | null;
}) {
  try {
    await sendToRoles(["ADMIN", "MANAGER", "STAFF", "KITCHEN"], {
      title: `New ${order.orderType === "DINE_IN" ? "dine-in" : "takeaway"} order`,
      body: `#${order.id.slice(-6).toUpperCase()} · $${order.totalAmount.toFixed(2)}${
        order.tableName ? ` · Table ${order.tableName}` : ""
      }`,
      url: "/orders/history",
      tag: `order-${order.id}`,
      template: "push-new-order",
    });
  } catch (e: any) {
    console.error("[notify] pushNewOrder failed:", e?.message);
  }
}

export async function pushReservation(reservation: {
  id: string;
  customerName?: string | null;
  guests: number;
  date: Date | string;
}) {
  try {
    await sendToRoles(["ADMIN", "MANAGER", "STAFF"], {
      title: "New table booking",
      body: `${reservation.customerName || "Guest"} · ${reservation.guests} guest(s) · ${new Date(
        reservation.date,
      ).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      url: "/admin/reservations",
      tag: `reservation-${reservation.id}`,
      template: "push-new-reservation",
    });
  } catch (e: any) {
    console.error("[notify] pushReservation failed:", e?.message);
  }
}

export async function pushOrderStatus(
  userId: string | null | undefined,
  orderId: string,
  status: string,
) {
  if (!userId) return;
  try {
    await sendToUser(userId, {
      title: `Order #${orderId.slice(-6).toUpperCase()} is ${status.toLowerCase()}`,
      body:
        status === "READY"
          ? "Your order is ready for pickup!"
          : status === "PREPARING"
            ? "The kitchen is preparing your order."
            : status === "SERVED"
              ? "Enjoy your meal!"
              : `Status updated to ${status}.`,
      url: "/orders/history",
      tag: `order-${orderId}`,
      template: "push-order-status",
    });
  } catch (e: any) {
    console.error("[notify] pushOrderStatus failed:", e?.message);
  }
}

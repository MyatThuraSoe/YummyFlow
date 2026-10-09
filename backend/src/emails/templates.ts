import {
  layout,
  detailRow,
  detailsTable,
  statusPill,
  escapeHtml,
} from "./layout";

export type RenderedEmail = { subject: string; html: string };

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const prettyDate = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const itemLine = (name: string, qty: number, price: number) => `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;">
      <span style="font-weight:600;">${escapeHtml(name)}</span>
      <span style="color:#64748b;"> &times; ${qty}</span>
    </td>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;
               font-weight:600;text-align:right;">
      ${money(price * qty)}
    </td>
  </tr>`;

/* ------------------------------------------------------------------ */
/* 1. Welcome                                                          */
/* ------------------------------------------------------------------ */

export function welcomeEmail({
  name,
  appUrl,
}: {
  name: string;
  appUrl: string;
}): RenderedEmail {
  return {
    subject: "Welcome to DineFlow 🍽️",
    html: layout({
      preheader: "Your DineFlow account is ready.",
      title: `Welcome aboard, ${name}!`,
      body: `
        <p style="margin:0 0 12px 0;">
          Your DineFlow account is ready. You can now browse the menu, reserve a
          table, and track your orders in real time.
        </p>
        <p style="margin:0 0 4px 0;color:#64748b;font-size:14px;">
          Here is what you can do right away:
        </p>
        <ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.9;">
          <li>Browse the live menu and place an order</li>
          <li>Reserve a table and get instant confirmation</li>
          <li>Track your order status as the kitchen prepares it</li>
        </ul>`,
      cta: { label: "Open DineFlow", url: appUrl },
      footerNote:
        "You received this email because an account was created with this address.",
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 2. Order receipt                                                    */
/* ------------------------------------------------------------------ */

export type ReceiptItem = { name: string; quantity: number; price: number };

export function orderReceiptEmail({
  customerName,
  orderId,
  orderType,
  tableName,
  items,
  totalAmount,
  paymentMethod,
  paymentStatus,
}: {
  customerName: string;
  orderId: string;
  orderType: string;
  tableName?: string | null;
  items: ReceiptItem[];
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
}): RenderedEmail {
  const shortId = orderId.slice(-6).toUpperCase();
  const paid = paymentStatus === "PAID";

  const rows = [
    detailRow("Order", `#${shortId}`),
    detailRow("Type", orderType.replace("_", " ")),
    tableName ? detailRow("Table", tableName) : "",
    detailRow("Payment", `${paymentMethod} · ${paymentStatus}`),
  ].join("");

  return {
    subject: `Your DineFlow receipt — Order #${shortId}`,
    html: layout({
      preheader: `${money(totalAmount)} · ${items.length} item(s)`,
      title: `Thanks for your order, ${customerName}!`,
      body: `
        <p style="margin:0 0 16px 0;">
          ${paid ? "We have received your payment." : "Your order has been placed."}
          Here is your receipt.
        </p>
        ${detailsTable(rows)}

        <p style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:#64748b;
                  text-transform:uppercase;letter-spacing:0.6px;">Items</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin-bottom:8px;">
          ${items.map((i) => itemLine(i.name, i.quantity, i.price)).join("")}
          <tr>
            <td style="padding:14px 0 4px 0;font-size:16px;font-weight:800;color:#0f172a;">Total</td>
            <td style="padding:14px 0 4px 0;font-size:16px;font-weight:800;color:#ff6347;
                       text-align:right;">${money(totalAmount)}</td>
          </tr>
        </table>`,
      footerNote:
        "Keep this email as your receipt. If anything looks wrong, contact the restaurant.",
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Reservation confirmation                                         */
/* ------------------------------------------------------------------ */

export function reservationConfirmationEmail({
  customerName,
  date,
  guests,
  tableName,
  appUrl,
}: {
  customerName: string;
  date: Date | string;
  guests: number;
  tableName: string;
  appUrl: string;
}): RenderedEmail {
  const rows = [
    detailRow("Guest name", customerName),
    detailRow("Date & time", prettyDate(date)),
    detailRow("Party size", `${guests} guest${guests === 1 ? "" : "s"}`),
    detailRow("Table", tableName),
    detailRow("Status", "Pending confirmation"),
  ].join("");

  return {
    subject: `Table booked for ${prettyDate(date)}`,
    html: layout({
      preheader: `${guests} guest(s) · ${tableName}`,
      title: "Your table is booked!",
      body: `
        <p style="margin:0 0 16px 0;">
          Hi ${escapeHtml(customerName)}, we have received your reservation request.
          Our team will confirm it shortly — you will get another email the moment
          it is confirmed.
        </p>
        ${detailsTable(rows)}
        <p style="margin:0;color:#64748b;font-size:14px;">
          Need to change something? You can manage this booking from your profile.
        </p>`,
      cta: { label: "View my reservations", url: appUrl },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Reservation status change                                        */
/* ------------------------------------------------------------------ */

const STATUS_COPY: Record<
  string,
  { subject: string; title: string; tone: "good" | "warn" | "bad"; blurb: string }
> = {
  CONFIRMED: {
    subject: "Your reservation is confirmed ✅",
    title: "Reservation confirmed",
    tone: "good",
    blurb: "Great news — your table is confirmed. We look forward to seeing you!",
  },
  CANCELLED: {
    subject: "Your reservation was cancelled",
    title: "Reservation cancelled",
    tone: "bad",
    blurb:
      "Your reservation has been cancelled and the table released. If this was not expected, please contact us.",
  },
  COMPLETED: {
    subject: "Thanks for dining with us 🍽️",
    title: "Reservation completed",
    tone: "good",
    blurb: "Thank you for dining with us. We hope you enjoyed your visit!",
  },
  PENDING: {
    subject: "Your reservation is pending",
    title: "Reservation pending",
    tone: "warn",
    blurb: "Your reservation is awaiting confirmation from our team.",
  },
};

export function reservationStatusEmail({
  customerName,
  status,
  date,
  guests,
  tableName,
  appUrl,
}: {
  customerName: string;
  status: string;
  date: Date | string;
  guests: number;
  tableName: string;
  appUrl: string;
}): RenderedEmail {
  const copy =
    STATUS_COPY[status] ??
    ({
      subject: `Reservation update — ${status}`,
      title: "Reservation updated",
      tone: "warn" as const,
      blurb: `Your reservation status is now ${status}.`,
    } as const);

  const rows = [
    detailRow("Guest name", customerName),
    detailRow("Date & time", prettyDate(date)),
    detailRow("Party size", `${guests} guest${guests === 1 ? "" : "s"}`),
    detailRow("Table", tableName),
  ].join("");

  return {
    subject: copy.subject,
    html: layout({
      preheader: copy.blurb,
      title: copy.title,
      body: `
        <p style="margin:0 0 12px 0;">${escapeHtml(copy.blurb)}</p>
        <p style="margin:0 0 16px 0;">${statusPill(status, copy.tone)}</p>
        ${detailsTable(rows)}`,
      cta: { label: "View my reservations", url: appUrl },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Account status (ban / suspend)                                   */
/* ------------------------------------------------------------------ */

export function accountStatusEmail({
  name,
  banned,
  reason,
  appUrl,
}: {
  name: string;
  banned: boolean;
  reason?: string | null;
  appUrl: string;
}): RenderedEmail {
  return {
    subject: banned ? "Your DineFlow account has been suspended" : "Your DineFlow account is active again",
    html: layout({
      preheader: banned ? "Account suspended" : "Account restored",
      title: banned ? "Your account has been suspended" : "Welcome back!",
      body: banned
        ? `
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(name)}, your DineFlow account has been suspended.</p>
          ${reason ? `<p style="margin:0 0 12px 0;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}
          <p style="margin:0;color:#64748b;font-size:14px;">
            If you believe this is a mistake, please contact the restaurant directly.
          </p>`
        : `
          <p style="margin:0 0 12px 0;">
            Hi ${escapeHtml(name)}, good news — your DineFlow account has been restored
            and you can sign in again.
          </p>`,
      cta: { label: "Go to DineFlow", url: appUrl },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 6. Test email (admin health check)                                  */
/* ------------------------------------------------------------------ */

export function testEmail({
  mode,
  appUrl,
}: {
  mode: "smtp" | "outbox";
  appUrl: string;
}): RenderedEmail {
  return {
    subject: "DineFlow email system — test message",
    html: layout({
      preheader: `Delivery mode: ${mode}`,
      title: "Email system is working",
      body: `
        <p style="margin:0 0 12px 0;">
          This is a test message from your DineFlow backend. If you can read this,
          the mailer, templates and delivery logging are all wired up correctly.
        </p>
        ${detailsTable(
          detailRow("Delivery mode", mode === "smtp" ? "SMTP (live)" : "Outbox (no SMTP configured)"),
        )}
        <p style="margin:0;color:#64748b;font-size:14px;">
          ${
            mode === "outbox"
              ? "No SMTP credentials are set, so messages are rendered to <code>backend/.mail-outbox/</code> instead of being delivered."
              : "Messages are being delivered over SMTP."
          }
        </p>`,
      cta: { label: "Open dashboard", url: appUrl },
    }),
  };
}

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * DineFlow mailer.
 *
 * Two modes, chosen automatically from the environment:
 *
 *  1. SMTP mode  — when SMTP_HOST + SMTP_PORT are set, mail is really delivered.
 *  2. Outbox mode — otherwise mail is *rendered and persisted* to
 *     `backend/.mail-outbox/<timestamp>-<to>.html` and a preview path is returned.
 *
 * Outbox mode exists so the whole email pipeline (templates, wiring, logging) is
 * fully functional and testable on a fresh clone with zero credentials — which is
 * exactly what the free version was missing.
 */

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  MAIL_FROM_NAME: MAIL_FROM_NAME_ENV,
} = process.env;

export const MAIL_FROM_ADDRESS = MAIL_FROM || "no-reply@dineflow.local";
export const MAIL_FROM_NAME = MAIL_FROM_NAME_ENV || "DineFlow";
export const fromHeader = `"${MAIL_FROM_NAME}" <${MAIL_FROM_ADDRESS}>`;

export const isSmtpConfigured = Boolean(SMTP_HOST && SMTP_PORT);

const OUTBOX_DIR = path.resolve(process.cwd(), ".mail-outbox");

const transporter: Transporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true" || Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : // No credentials: keep the exact same code path but capture the message
    // instead of sending it over the wire.
    nodemailer.createTransport({ jsonTransport: true });

/** Crude but dependable HTML -> text fallback for clients that reject HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type MailPayload = {
  to: string;
  subject: string;
  html: string;
  /** Used for the outbox filename + logging; e.g. "order-receipt". */
  template: string;
};

export type MailResult =
  | { ok: true; messageId?: string; preview?: string }
  | { ok: false; error: string };

async function writeToOutbox(payload: MailPayload): Promise<string | undefined> {
  try {
    await fs.mkdir(OUTBOX_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = payload.to.replace(/[^a-z0-9._@-]/gi, "_");
    const file = path.join(OUTBOX_DIR, `${stamp}-${payload.template}-${safeTo}.html`);
    await fs.writeFile(file, payload.html, "utf8");
    return file;
  } catch (error) {
    console.error("[mailer] failed to write outbox file:", error);
    return undefined;
  }
}

export async function sendMail(payload: MailPayload): Promise<MailResult> {
  try {
    const info = await transporter.sendMail({
      from: fromHeader,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: htmlToText(payload.html),
    });

    if (isSmtpConfigured) {
      console.log(`[mailer] sent "${payload.subject}" -> ${payload.to}`);
      return { ok: true, messageId: info.messageId };
    }

    const preview = await writeToOutbox(payload);
    console.log(
      `[mailer] SMTP not configured — rendered "${payload.subject}" -> ${payload.to}` +
        (preview ? `\n         preview: ${preview}` : ""),
    );
    return { ok: true, messageId: info.messageId, preview };
  } catch (error: any) {
    console.error(`[mailer] FAILED "${payload.subject}" -> ${payload.to}:`, error?.message);
    return { ok: false, error: error?.message ?? "unknown mailer error" };
  }
}

/** Health probe used by the admin "Send test email" action. */
export async function verifyMailer(): Promise<{
  mode: "smtp" | "outbox";
  ok: boolean;
  error?: string;
}> {
  if (!isSmtpConfigured) return { mode: "outbox", ok: true };
  try {
    await transporter.verify();
    return { mode: "smtp", ok: true };
  } catch (error: any) {
    return { mode: "smtp", ok: false, error: error?.message };
  }
}

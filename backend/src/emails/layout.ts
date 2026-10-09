/**
 * Shared HTML shell for every DineFlow transactional email.
 *
 * Deliberately table-based with inline styles: email clients (Outlook especially)
 * ignore <style> blocks and flexbox, so this is the boring-but-works approach.
 */

const BRAND = "#ff6347"; // matches --color-primary in app/app.css
const INK = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const CANVAS = "#f1f5f9";

export type LayoutOptions = {
  /** Small grey text shown next to the subject in most inboxes. */
  preheader?: string;
  title: string;
  /** Inner HTML for the card body. */
  body: string;
  /** Optional call-to-action rendered as a button. */
  cta?: { label: string; url: string };
  footerNote?: string;
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function layout({
  preheader,
  title,
  body,
  cta,
  footerNote,
}: LayoutOptions): string {
  const year = new Date().getFullYear();

  const ctaBlock = cta
    ? `
      <tr>
        <td style="padding:8px 32px 32px 32px;" align="center">
          <a href="${escapeHtml(cta.url)}"
             style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                    font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
${
  preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${CANVAS};padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;
                    border:1px solid ${BORDER};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <!-- Header -->
        <tr>
          <td style="background:${INK};padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.4px;">
              Dine<span style="color:${BRAND};">Flow</span>
            </span>
          </td>
        </tr>

        <!-- Title -->
        <tr>
          <td style="padding:32px 32px 8px 32px;">
            <h1 style="margin:0;font-size:22px;line-height:1.3;color:${INK};font-weight:800;">
              ${escapeHtml(title)}
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:8px 32px 24px 32px;color:#334155;font-size:15px;line-height:1.65;">
            ${body}
          </td>
        </tr>

        ${ctaBlock}

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid ${BORDER};padding:20px 32px;">
            <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.6;">
              ${footerNote ? escapeHtml(footerNote) : "You are receiving this email because you have a DineFlow account or placed an order with us."}
            </p>
            <p style="margin:8px 0 0 0;color:${MUTED};font-size:12px;">
              &copy; ${year} DineFlow Restaurant Management. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Small helper for a label/value row used in receipts and booking details. */
export function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 0;color:${MUTED};font-size:14px;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:${INK};font-size:14px;font-weight:600;text-align:right;">
        ${escapeHtml(value)}
      </td>
    </tr>`;
}

/** Wraps rows in a bordered summary table. */
export function detailsTable(rows: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid ${BORDER};border-radius:12px;padding:4px 16px;margin:8px 0 16px 0;">
      ${rows}
    </table>`;
}

export function statusPill(text: string, tone: "good" | "warn" | "bad"): string {
  const tones = {
    good: { bg: "#dcfce7", fg: "#15803d" },
    warn: { bg: "#fef3c7", fg: "#b45309" },
    bad: { bg: "#fee2e2", fg: "#b91c1c" },
  }[tone];
  return `<span style="display:inline-block;background:${tones.bg};color:${tones.fg};
    font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;
    text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(text)}</span>`;
}

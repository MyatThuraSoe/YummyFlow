/** Minimal CSV serialiser for report exports. */

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(cell).join(",");
  const body = rows.map((r) => r.map(cell).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/**
 * Minimal RFC 4180 CSV (quoted fields, "" escapes, newlines inside quotes, CRLF or LF).
 * Enough for the hand-labelled eval files, which must open cleanly in Excel / Google Sheets.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ""));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Writes a header plus rows. A UTF-8 BOM is added so Excel detects the encoding. */
export function toCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => quote(r[c] ?? "")).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

// Splid (splid.app) exports a binary OLE .xls with a "balance matrix" shape:
// one header row naming each member, two columns per member per data row
// ([paidAmount, -share]), one row per expense, and a trailing blank-title row
// of running totals. See docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md.
import { read, utils } from "xlsx";
import type { ParseResult, ParsedImportRow } from "~/shared/import/types";

const FIXED_COLUMNS = ["Title", "Amount", "Currency", "By", "Date", "Created on"];

/** "M/D/YY" -> epoch ms at local midnight. Splid's "Date" column is
 *  frequently garbled by a unicode bug in their exporter (shows up as a
 *  single replacement character); "Created on" is the reliable field. */
function parseCreatedOn(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = 2000 + Number(y);
  const ms = new Date(year, Number(mo) - 1, Number(d)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseSplidXls(bytes: ArrayBuffer | Uint8Array): ParseResult {
  const wb = read(bytes, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /summary/i.test(n)) ?? wb.SheetNames[0];
  if (!sheetName) return { sourceNames: [], rows: [], warnings: ["No sheet found in file"] };
  const sheet = wb.Sheets[sheetName]!;
  const aoa = utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  const headerIdx = aoa.findIndex((r) => r[0] === "Title" && r[1] === "Amount");
  if (headerIdx === -1) return { sourceNames: [], rows: [], warnings: ["Could not find the expense header row"] };
  const header = aoa[headerIdx]!;

  // Member columns start right after the fixed columns, two per member
  // (name, blank). Only the even offset within each pair carries a header.
  const members: Array<{ name: string; paidCol: number; shareCol: number }> = [];
  for (let i = FIXED_COLUMNS.length; i < header.length; i += 2) {
    const name = header[i];
    if (typeof name === "string" && name.trim()) {
      members.push({ name: name.trim(), paidCol: i, shareCol: i + 1 });
    }
  }

  const rows: ParsedImportRow[] = [];
  const warnings: string[] = [];
  const sourceNames = new Set<string>();

  for (const r of aoa.slice(headerIdx + 1)) {
    const title = r[0];
    if (typeof title !== "string" || !title.trim()) continue; // blank-title totals row

    const amount = r[1];
    const currency = r[2];
    const by = r[3];
    if (typeof amount !== "number" || amount === 0) {
      warnings.push(`Skipped "${title}": no numeric amount`);
      continue;
    }
    if (currency !== "INR") {
      warnings.push(`Skipped "${title}": currency is ${String(currency)}, not INR`);
      continue;
    }
    if (typeof by !== "string" || !by.trim()) {
      warnings.push(`Skipped "${title}": no payer in the "By" column`);
      continue;
    }

    const shares: Array<{ name: string; sharePaise: number }> = [];
    for (const m of members) {
      const share = r[m.shareCol];
      if (typeof share !== "number" || share === 0) continue;
      shares.push({ name: m.name, sharePaise: Math.round(-share * 100) });
    }
    if (shares.length === 0) {
      warnings.push(`Skipped "${title}": no per-person shares found`);
      continue;
    }

    const dateMs = parseCreatedOn(r[5]) ?? Date.now();
    rows.push({ title: title.trim(), amountPaise: Math.round(amount * 100), dateMs, payerName: by.trim(), shares });
    sourceNames.add(by.trim());
    for (const s of shares) sourceNames.add(s.name);
  }

  return { sourceNames: [...sourceNames], rows, warnings };
}

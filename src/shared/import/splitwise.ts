// Splitwise's CSV export: one row per expense, Date/Description/Category/Cost/
// Currency, then one column PER PERSON holding their net balance for that row
// (paid - owed; positive = they fronted more than their share). Splitwise is
// single-payer per expense, so exactly one person's net must be positive - that
// person is the payer, and their surplus plus everyone else's negative net
// reconstructs each person's share. See
// docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md and
// https://github.com/spliit-app/spliit/issues/22.
import type { ParseResult, ParsedImportRow } from "~/shared/import/types";

/** Minimal RFC4180: quoted fields, "" escapes a literal quote, commas inside
 *  quotes are not field separators. No embedded newlines in a field - none of
 *  Splitwise's columns need them. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const FIXED_COLUMNS = ["Date", "Description", "Category", "Cost", "Currency"];

export function parseSplitwiseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { sourceNames: [], rows: [], warnings: ["Empty file"] };

  const header = parseCsvLine(lines[0]!);
  if (FIXED_COLUMNS.some((c, i) => header[i] !== c)) {
    return { sourceNames: [], rows: [], warnings: ["Unrecognized CSV header - expected Date,Description,Category,Cost,Currency,..."] };
  }
  const people = header.slice(FIXED_COLUMNS.length).map((n) => n.trim()).filter((n) => n);

  const rows: ParsedImportRow[] = [];
  const warnings: string[] = [];
  const sourceNames = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const [dateStr, description, , costStr, currency] = cells;
    const title = (description ?? "").trim();
    const cost = Number(costStr);
    if (!costStr || !Number.isFinite(cost) || cost === 0) continue; // footer/total row

    if (currency !== "INR") {
      warnings.push(`Skipped "${title || dateStr}": currency is ${String(currency)}, not INR`);
      continue;
    }

    const nets = people.map((name, i) => ({ name, net: Number(cells[FIXED_COLUMNS.length + i]) }));
    const positives = nets.filter((n) => Number.isFinite(n.net) && n.net > 0);
    if (positives.length !== 1) {
      warnings.push(`Skipped "${title || dateStr}": expected exactly one payer, found ${positives.length}`);
      continue;
    }
    const payerName = positives[0]!.name;

    const costPaise = Math.round(cost * 100);
    const shares = nets
      .filter((n) => Number.isFinite(n.net) && n.net !== 0)
      .map((n) => ({
        name: n.name,
        // share = paid - net; paid is the full cost for the payer, 0 for everyone else.
        sharePaise: Math.round((n.name === payerName ? cost : 0) * 100 - n.net * 100),
      }));
    if (shares.length === 0) {
      warnings.push(`Skipped "${title || dateStr}": no per-person shares found`);
      continue;
    }

    const dateMs = dateStr ? new Date(`${dateStr}T00:00:00`).getTime() : Date.now();
    rows.push({
      title: title || "Imported expense",
      amountPaise: costPaise,
      dateMs: Number.isFinite(dateMs) ? dateMs : Date.now(),
      payerName,
      shares,
    });
    sourceNames.add(payerName);
    for (const s of shares) sourceNames.add(s.name);
  }

  return { sourceNames: [...sourceNames], rows, warnings };
}

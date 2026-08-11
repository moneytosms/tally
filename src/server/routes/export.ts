import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";

/** Escape CSV field: wrap in quotes and double internal quotes, prefix with ' if formula-like */
function escapeCsv(value: string): string {
  let needsQuote = false;
  // Check if original value needs quoting or special handling
  if (/^[=+\-@]/.test(value) || value.includes(",") || value.includes('"') || value.includes("\n") || /^\s|\s$/.test(value)) {
    needsQuote = true;
  }

  let escaped = value.replace(/"/g, '""');
  if (/^[=+\-@]/.test(value)) {
    escaped = "'" + escaped;
  }
  if (needsQuote) {
    escaped = `"${escaped}"`;
  }
  return escaped;
}

/** Convert paise (integer) to rupee string, handling negatives correctly */
function paiseToRupee(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const paise_part = String(abs % 100).padStart(2, "0");
  return `${sign}${rupees}.${paise_part}`;
}

/** Convert epoch ms to ISO date */
function epochToDate(epochMs: number): string {
  return new Date(epochMs).toISOString().split("T")[0] || "";
}

const exp = new Hono<Env>();

/** Export all ledgers the caller is a member of */
exp.get("/export.csv", requireSession, async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;

  const ledgers = await db.listLedgersForUser(userId);
  const rows: string[] = [];

  rows.push(
    escapeCsv("ledger") +
      "," +
      escapeCsv("date") +
      "," +
      escapeCsv("description") +
      "," +
      escapeCsv("category") +
      "," +
      escapeCsv("payer") +
      "," +
      escapeCsv("total_paise") +
      "," +
      escapeCsv("total_inr") +
      "," +
      escapeCsv("participant") +
      "," +
      escapeCsv("share_paise") +
      "," +
      escapeCsv("share_inr") +
      "," +
      escapeCsv("notes"),
  );

  for (const { ledger } of ledgers) {
    const [expenses, members, categories] = await Promise.all([
      db.listExpenses(ledger.id),
      db.listMembers(ledger.id),
      db.listCategories(),
    ]);
    const memberMap = new Map(members.map((m) => [m.id, m]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    for (const expense of expenses) {
      const payer = memberMap.get(expense.payerMemberId);
      const categoryName = expense.categoryId ? categoryMap.get(expense.categoryId)?.name : "";
      const date = epochToDate(expense.paidAt);
      const totalInr = paiseToRupee(expense.total);

      for (const split of expense.splits) {
        const participant = memberMap.get(split.memberId);
        const shareInr = paiseToRupee(split.amount);

        rows.push(
          [
            escapeCsv(ledger.name),
            escapeCsv(date),
            escapeCsv(expense.description),
            escapeCsv(categoryName || ""),
            escapeCsv(payer?.nickname ?? payer?.guestName ?? "Unknown"),
            String(expense.total),
            escapeCsv(totalInr),
            escapeCsv(participant?.nickname ?? participant?.guestName ?? "Unknown"),
            String(split.amount),
            escapeCsv(shareInr),
            escapeCsv(expense.notes || ""),
          ].join(","),
        );
      }
    }
  }

  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="tally-export.csv"`,
  };
  return new Response(rows.join("\n"), {
    status: 200,
    headers,
  });
});

/** Export a single ledger */
exp.get("/ledgers/:ledgerId/export.csv", requireSession, requireMember, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const [expenses, members, categories] = await Promise.all([
    db.listExpenses(ledgerId),
    db.listMembers(ledgerId),
    db.listCategories(),
  ]);

  const ledger = await db.findLedger(ledgerId);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const rows: string[] = [];

  rows.push(
    escapeCsv("ledger") +
      "," +
      escapeCsv("date") +
      "," +
      escapeCsv("description") +
      "," +
      escapeCsv("category") +
      "," +
      escapeCsv("payer") +
      "," +
      escapeCsv("total_paise") +
      "," +
      escapeCsv("total_inr") +
      "," +
      escapeCsv("participant") +
      "," +
      escapeCsv("share_paise") +
      "," +
      escapeCsv("share_inr") +
      "," +
      escapeCsv("notes"),
  );

  for (const expense of expenses) {
    const payer = memberMap.get(expense.payerMemberId);
    const categoryName = expense.categoryId ? categoryMap.get(expense.categoryId)?.name : "";
    const date = epochToDate(expense.paidAt);
    const totalInr = paiseToRupee(expense.total);

    for (const split of expense.splits) {
      const participant = memberMap.get(split.memberId);
      const shareInr = paiseToRupee(split.amount);

      rows.push(
        [
          escapeCsv(ledger?.name || ""),
          escapeCsv(date),
          escapeCsv(expense.description),
          escapeCsv(categoryName || ""),
          escapeCsv(payer?.nickname ?? payer?.guestName ?? "Unknown"),
          String(expense.total),
          escapeCsv(totalInr),
          escapeCsv(participant?.nickname ?? participant?.guestName ?? "Unknown"),
          String(split.amount),
          escapeCsv(shareInr),
          escapeCsv(expense.notes || ""),
        ].join(","),
      );
    }
  }

  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="tally-export-${ledgerId}.csv"`,
  };
  return new Response(rows.join("\n"), {
    status: 200,
    headers,
  });
});

export default exp;

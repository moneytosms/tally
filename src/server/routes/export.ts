import { Hono } from "hono";
import { utils, write } from "xlsx";
import type { Db } from "~/db";
import type { Env } from "~/server/context";
import { grossPairs, memberBreakdown, netPositions, transferPlan } from "~/server/balances";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";

/** Escape CSV field: wrap in quotes and double internal quotes, prefix with ' if formula-like */
function escapeCsv(value: string): string {
  // Plain signed decimals (refund rupee amounts) are numbers, not formulas.
  const formula = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value);
  let needsQuote = false;
  // Check if original value needs quoting or special handling
  if (formula || value.includes(",") || value.includes('"') || value.includes("\n") || /^\s|\s$/.test(value)) {
    needsQuote = true;
  }

  let escaped = value.replace(/"/g, '""');
  if (formula) {
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

// shortcut: assumes IST (app is INR-only), take a tz query param if non-India users appear
const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
/** Epoch ms to YYYY-MM-DD in IST. Expenses are stored at local midnight. */
function epochToDate(epochMs: number): string {
  return istDay.format(new Date(epochMs));
}

/** UTF-8 BOM so Excel decodes non-ASCII names instead of guessing a codepage. */
const BOM = "\uFEFF";

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
  return new Response(BOM + rows.join("\n"), {
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
  return new Response(BOM + rows.join("\n"), {
    status: 200,
    headers,
  });
});

type Cell = string | number;
type Section = { name: string; rows: Cell[][] }; // rows[0] is the header

/** Integer paise plus its rupee string. Money is never summed as a float. */
const money = (paise: number): Cell[] => [paise, paiseToRupee(paise)];

/** The settle export, built once and serialised twice. Balances come from the same
 *  functions as /balances, so the two cannot disagree. Soft-deleted rows are
 *  already filtered by the data layer. */
async function settleSections(db: Db, ledgerId: string): Promise<Section[]> {
  const [expenses, settlements, members, users, categories] = await Promise.all([
    db.listExpenses(ledgerId),
    db.listSettlements(ledgerId),
    db.listMembersForActivity(ledgerId),
    db.listUsers(),
    db.listCategories(),
  ]);
  const displayNames = new Map(users.map((u) => [u.id, u.displayName]));
  // Same naming as the balances route: nickname, then guest name, then account name.
  const nameOf = new Map(
    members.map((m) => [m.id, m.nickname ?? m.guestName ?? (m.userId && displayNames.get(m.userId)) ?? ""]),
  );
  const name = (id: string) => nameOf.get(id) ?? "";
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const byFromTo = (a: { from: string; to: string }, b: { from: string; to: string }) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to);

  const breakdown = new Map(memberBreakdown(expenses, settlements).map((b) => [b.memberId, b]));
  const positions = netPositions(expenses, settlements)
    .map((p) => ({ name: name(p.memberId), p, b: breakdown.get(p.memberId)! }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.p.memberId.localeCompare(b.p.memberId));
  const edges = (list: Array<{ fromMemberId: string; toMemberId: string; amount: number }>) =>
    list.map((t) => ({ from: name(t.fromMemberId), to: name(t.toMemberId), amount: t.amount })).sort(byFromTo);

  return [
    {
      name: "Net positions",
      rows: [
        [
          "member",
          "paid_paise",
          "paid_inr",
          "share_paise",
          "share_inr",
          "settled_out_paise",
          "settled_out_inr",
          "settled_in_paise",
          "settled_in_inr",
          "net_paise",
          "net_inr",
          "status",
        ],
        ...positions.map(({ name: n, p, b }) => [
          n,
          ...money(b.paid),
          ...money(b.share),
          ...money(b.settledOut),
          ...money(b.settledIn),
          ...money(p.net),
          p.net > 0 ? "is owed" : p.net < 0 ? "owes" : "settled",
        ]),
      ],
    },
    {
      name: "Transfer plan",
      rows: [
        ["from", "to", "amount_paise", "amount_inr"],
        ...edges(transferPlan(netPositions(expenses, settlements))).map((t) => [t.from, t.to, ...money(t.amount)]),
      ],
    },
    {
      name: "Direct debts",
      rows: [
        ["from", "to", "amount_paise", "amount_inr"],
        ...edges(grossPairs(expenses, settlements)).map((t) => [t.from, t.to, ...money(t.amount)]),
      ],
    },
    {
      name: "Settlements",
      rows: [
        ["date", "from", "to", "amount_paise", "amount_inr", "method", "note"],
        ...[...settlements]
          .sort((a, b) => a.declaredAt - b.declaredAt || a.id.localeCompare(b.id))
          .map((s) => [
            epochToDate(s.declaredAt),
            name(s.fromMemberId),
            name(s.toMemberId),
            ...money(s.amount),
            s.method,
            s.note ?? "",
          ]),
      ],
    },
    {
      name: "Expenses",
      rows: [
        [
          "date",
          "description",
          "category",
          "payer",
          "total_paise",
          "total_inr",
          "participant",
          "share_paise",
          "share_inr",
          "notes",
        ],
        ...[...expenses]
          .sort((a, b) => a.paidAt - b.paidAt || a.id.localeCompare(b.id))
          .flatMap((e) =>
            e.splits.map((s) => [
              epochToDate(e.paidAt),
              e.description,
              (e.categoryId && categoryMap.get(e.categoryId)) || "",
              name(e.payerMemberId),
              ...money(e.total),
              name(s.memberId),
              ...money(s.amount),
              e.notes ?? "",
            ]),
          ),
      ],
    },
  ];
}

/** CSV: each section is a title row, its header and rows, then a blank line. */
function toCsv(sections: Section[]): string {
  const lines = sections.flatMap((s) => [
    escapeCsv(s.name),
    ...s.rows.map((r) => r.map((c) => (typeof c === "number" ? String(c) : escapeCsv(c))).join(",")),
    "",
  ]);
  return BOM + lines.join("\n");
}

/** XLSX: one sheet per section. Numbers stay numeric, rupee strings stay text. */
function toXlsx(sections: Section[]): ArrayBuffer {
  const wb = utils.book_new();
  for (const s of sections) utils.book_append_sheet(wb, utils.aoa_to_sheet(s.rows), s.name);
  return write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Settle data for one ledger. Readable on archived ledgers: no archive check here. */
exp.get("/ledgers/:ledgerId/settle.csv", requireSession, requireMember, async (c) => {
  const sections = await settleSections(c.var.db, c.req.param("ledgerId"));
  return new Response(toCsv(sections), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tally-settle-${c.req.param("ledgerId")}.csv"`,
    },
  });
});

exp.get("/ledgers/:ledgerId/settle.xlsx", requireSession, requireMember, async (c) => {
  const sections = await settleSections(c.var.db, c.req.param("ledgerId"));
  return new Response(toXlsx(sections), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tally-settle-${c.req.param("ledgerId")}.xlsx"`,
    },
  });
});

export default exp;

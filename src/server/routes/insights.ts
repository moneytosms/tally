// Lifetime analytics for the calling user only - never another user's figures.
//
// `spent` / `byCategory` / `byMonth` come from `listExpenseSharesForUser`, one
// row per split the caller owns. `paid` and `mostSpentWith` need more than that
// row can say - an expense the caller PAID but did not split, and who ELSE has
// a split on an expense - so those two walk `listExpenses` per ledger the
// caller belongs to (via `listLedgersForUser`), the same per-ledger-loop idiom
// `GET /balances` already uses in balances.ts. Ledger counts are small in this
// app (self-hosted, ~20 users), so that loop stays well under the 10ms ceiling.
//
// Mounted at `/api` by the root app; paths below are relative to that.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";

const insights = new Hono<Env>();

/** UTC month key from epoch ms - a local-timezone bucket would put the same
 *  expense in different months for different viewers. */
function monthKey(epochMs: number) {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every month between two "YYYY-MM" keys, inclusive, so a gap month reports
 *  spent: 0 instead of being silently absent. */
function fillMonths(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

insights.get("/insights", requireSession, async (c) => {
  const db = c.var.db;
  const userId = c.var.user.id;
  const fromParam = c.req.query("from");
  const fromMs = fromParam ? Number(fromParam) : undefined;
  const toParam = c.req.query("to");
  const toMs = toParam ? Number(toParam) : undefined;

  const [sharesAll, ledgersForUser] = await Promise.all([
    db.listExpenseSharesForUser(userId),
    db.listLedgersForUser(userId),
  ]);
  const shares = sharesAll.filter(
    (r) => (fromMs === undefined || r.paidAt >= fromMs) && (toMs === undefined || r.paidAt <= toMs),
  );

  let spent = 0;
  const expenseIds = new Set<string>();
  const byCategory = new Map<string | null, { spent: number; count: number }>();
  const byMonth = new Map<string, number>();

  for (const r of shares) {
    spent += r.share;
    expenseIds.add(r.expenseId);

    const cat = byCategory.get(r.categoryId) ?? { spent: 0, count: 0 };
    cat.spent += r.share;
    cat.count += 1;
    byCategory.set(r.categoryId, cat);

    const mk = monthKey(r.paidAt);
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + r.share);
  }

  // byCategory: one listCategories call, not per row. Null collapses into a
  // single "Uncategorised" entry; the client re-labels it via the locale.
  const categories = new Map((await db.listCategories()).map((cat) => [cat.id, cat]));
  const byCategoryOut = [...byCategory]
    .map(([categoryId, v]) => {
      const cat = categoryId ? categories.get(categoryId) : undefined;
      return { categoryId, name: cat?.name ?? "Uncategorised", icon: cat?.icon ?? null, spent: v.spent, count: v.count };
    })
    .sort((a, b) => b.spent - a.spent);

  // byMonth: fill gaps between the earliest and latest month present.
  const months = [...byMonth.keys()].sort();
  const byMonthOut =
    months.length === 0
      ? []
      : fillMonths(months[0]!, months[months.length - 1]!).map((month) => ({ month, spent: byMonth.get(month) ?? 0 }));

  // paid + mostSpentWith + ledgerCount: one listExpenses/listMembers pass per
  // ledger the caller is a member of, so a paid-but-not-participant expense is
  // still counted and co-participants can be identified.
  let paid = 0;
  const activeLedgerIds = new Set<string>();
  const coStats = new Map<string, { count: number; total: number }>();

  for (const { ledger, memberId } of ledgersForUser) {
    const [expenses, members] = await Promise.all([db.listExpenses(ledger.id), db.listMembers(ledger.id)]);
    const userIdByMemberId = new Map(members.map((m) => [m.id, m.userId]));

    for (const e of expenses) {
      if (fromMs !== undefined && e.paidAt < fromMs) continue;
      if (toMs !== undefined && e.paidAt > toMs) continue;

      if (e.payerMemberId === memberId) {
        paid += e.total;
        activeLedgerIds.add(ledger.id);
      }

      const own = e.splits.find((s) => s.memberId === memberId);
      if (!own) continue;
      activeLedgerIds.add(ledger.id);
      for (const s of e.splits) {
        if (s.memberId === memberId) continue;
        const otherUserId = userIdByMemberId.get(s.memberId);
        if (!otherUserId) continue; // guest - no userId
        const stat = coStats.get(otherUserId) ?? { count: 0, total: 0 };
        stat.count += 1;
        stat.total += own.amount;
        coStats.set(otherUserId, stat);
      }
    }
  }

  const users = new Map((await db.listUsers()).map((u) => [u.id, u]));
  const mostSpentWith = [...coStats]
    .map(([otherUserId, stat]) => ({
      userId: otherUserId,
      displayName: users.get(otherUserId)?.displayName ?? "",
      sharedExpenseCount: stat.count,
      sharedTotal: stat.total,
    }))
    .sort((a, b) => b.sharedTotal - a.sharedTotal)
    .slice(0, 10);

  return c.json({
    totals: { spent, paid, expenseCount: expenseIds.size, ledgerCount: activeLedgerIds.size },
    byCategory: byCategoryOut,
    byMonth: byMonthOut,
    mostSpentWith,
  });
});

/** Ledger-scoped insights: the WHOLE ledger's numbers, not filtered to the
 *  caller's own shares - this answers "what happened in this trip", not
 *  "what did I spend". Unlike the lifetime endpoint above, this one walks
 *  `listExpenses` directly since every expense in the ledger is in scope. */
insights.get("/ledgers/:ledgerId/insights", requireSession, requireMember, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  // listMembersForActivity, not listMembers: a member who left after paying or
  // sharing an expense must still get a name here - this is an insight, not a
  // balance. (Zero-value entries are filtered client-side, so including every
  // non-deleted member, current or departed, is harmless.)
  const [expenses, members, categories, users] = await Promise.all([
    db.listExpenses(ledgerId),
    db.listMembersForActivity(ledgerId),
    db.listCategories(),
    db.listUsers(),
  ]);
  const categoryById = new Map(categories.map((cat) => [cat.id, cat]));
  const displayNames = new Map(users.map((u) => [u.id, u.displayName]));
  const nameOfMember = new Map(
    members.map((m) => [m.id, m.nickname ?? m.guestName ?? (m.userId && displayNames.get(m.userId)) ?? ""]),
  );

  let spent = 0;
  const byCategory = new Map<string | null, { spent: number; count: number }>();
  const byMonth = new Map<string, number>();
  const paidByMember = new Map<string, number>();
  const shareByMember = new Map<string, number>();

  for (const e of expenses) {
    spent += e.total;

    const cat = byCategory.get(e.categoryId) ?? { spent: 0, count: 0 };
    cat.spent += e.total;
    cat.count += 1;
    byCategory.set(e.categoryId, cat);

    const mk = monthKey(e.paidAt);
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + e.total);

    paidByMember.set(e.payerMemberId, (paidByMember.get(e.payerMemberId) ?? 0) + e.total);
    for (const s of e.splits) {
      shareByMember.set(s.memberId, (shareByMember.get(s.memberId) ?? 0) + s.amount);
    }
  }

  const byCategoryOut = [...byCategory]
    .map(([categoryId, v]) => {
      const cat = categoryId ? categoryById.get(categoryId) : undefined;
      return { categoryId, name: cat?.name ?? "Uncategorised", icon: cat?.icon ?? null, spent: v.spent, count: v.count };
    })
    .sort((a, b) => b.spent - a.spent);

  const months = [...byMonth.keys()].sort();
  const byMonthOut =
    months.length === 0
      ? []
      : fillMonths(months[0]!, months[months.length - 1]!).map((month) => ({ month, spent: byMonth.get(month) ?? 0 }));

  // Every current member appears, even one with only a paid entry or only a
  // share entry - a zero on the side they didn't touch is the correct number,
  // not an absence.
  const memberIds = new Set([...members.map((m) => m.id), ...paidByMember.keys(), ...shareByMember.keys()]);
  const byMember = [...memberIds]
    .map((memberId) => ({
      memberId,
      nickname: nameOfMember.get(memberId) ?? "",
      paid: paidByMember.get(memberId) ?? 0,
      share: shareByMember.get(memberId) ?? 0,
    }))
    .sort((a, b) => b.share - a.share);

  return c.json({
    totals: { spent, expenseCount: expenses.length },
    byCategory: byCategoryOut,
    byMonth: byMonthOut,
    byMember,
  });
});

export default insights;

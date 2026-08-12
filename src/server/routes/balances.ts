// Balances are DERIVED on every request - never stored, never cached (ADR 0004,
// SPEC §6). A cached net position that disagrees with expense history is worse
// than a slow query, so there is deliberately no memoisation here.
//
// Mounted at `/api` by the root app; paths below are relative to that.
import { Hono } from "hono";
import type { Db } from "~/db";
import type { Env } from "~/server/context";
import { netPositions, transferPlan } from "~/server/balances";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import type { Paise } from "~/shared/money";
// Agent H owns the user serialiser. VPA is visible only to ledger co-members and
// that rule lives in one place - never spread a user row into a response.
import { serialiseUser } from "~/server/routes/me";

const balances = new Hono<Env>();

type Expenses = Awaited<ReturnType<Db["listExpenses"]>>;

/** The "why?" trail: the expenses `to` paid that `from` took a share of.
 *  Direct pairs only - see `pairs` below for simplified (indirect) transfers. */
function trailFor(expenses: Expenses, from: string, to: string) {
  return expenses
    .filter((e) => e.payerMemberId === to)
    .flatMap((e) => {
      const s = e.splits.find((x) => x.memberId === from);
      return !s || s.amount === 0
        ? []
        : [{ expenseId: e.id, description: e.description, paidAt: e.paidAt, amount: s.amount }];
    })
    .sort((a, b) => b.paidAt - a.paidAt);
}

/** Gross who-owes-whom before simplification. A simplified transfer often runs
 *  between two people with no shared expense; this is what makes that one
 *  explainable ("you owe B, B owes C"). */
function grossPairs(expenses: Expenses) {
  const acc = new Map<string, Paise>();
  for (const e of expenses) {
    for (const s of e.splits) {
      if (s.memberId === e.payerMemberId || s.amount === 0) continue;
      const key = `${s.memberId}\u0000${e.payerMemberId}`;
      acc.set(key, (acc.get(key) ?? 0) + s.amount);
    }
  }
  return [...acc].map(([key, amount]) => {
    const [fromMemberId, toMemberId] = key.split("\u0000") as [string, string];
    return { fromMemberId, toMemberId, amount };
  });
}

balances.get("/ledgers/:ledgerId/balances", requireSession, requireMember, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  const [expenses, settlements] = await Promise.all([db.listExpenses(ledgerId), db.listSettlements(ledgerId)]);

  const positions = netPositions(expenses, settlements);
  return c.json({
    positions,
    transfers: transferPlan(positions).map((t) => ({
      ...t,
      trail: trailFor(expenses, t.fromMemberId, t.toMemberId),
    })),
    pairs: grossPairs(expenses),
  });
});

/**
 * Cross-ledger net per friend: one number per person, summed over every ledger
 * shared with the viewer. Positive = that person is owed overall.
 *
 * Guests are per-ledger entities with no user and no VPA, so they cannot be
 * summed into a cross-ledger figure and are excluded here - they appear only in
 * their own ledger's balances. The viewer is excluded too; their own figure is
 * `net` on each ledger summary.
 *
 * Not ledger-scoped, so it carries requireSession itself.
 */
balances.get("/balances", requireSession, async (c) => {
  const db = c.var.db;
  const viewerId = c.var.user.id;

  const net = new Map<string, Paise>();
  const coMemberIds = new Set<string>();
  for (const { ledger } of await db.listLedgersForUser(viewerId)) {
    const [members, expenses, settlements] = await Promise.all([
      db.listMembers(ledger.id),
      db.listExpenses(ledger.id),
      db.listSettlements(ledger.id),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const m of members) if (m.userId) coMemberIds.add(m.userId);
    for (const p of netPositions(expenses, settlements)) {
      const userId = byId.get(p.memberId)?.userId;
      if (!userId || userId === viewerId) continue;
      net.set(userId, (net.get(userId) ?? 0) + p.net);
    }
  }

  const users = new Map((await db.listUsers()).map((u) => [u.id, u]));
  return c.json(
    [...net].flatMap(([userId, amount]) => {
      const row = users.get(userId);
      if (!row) return [];
      // Everyone here shares a ledger with the viewer by construction, but the
      // VPA decision stays in the serialiser rather than being asserted here.
      const u = serialiseUser(row, coMemberIds.has(userId));
      return [{ userId: u.id, displayName: u.displayName, vpa: u.vpa, net: amount }];
    }),
  );
});

export default balances;

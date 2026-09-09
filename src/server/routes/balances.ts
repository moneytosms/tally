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
type Settlements = Awaited<ReturnType<Db["listSettlements"]>>;

/**
 * The "why?" trail behind one suggested transfer: every direct movement between
 * `from` and `to`, signed so that POSITIVE means "this is part of why `from`
 * owes `to`".
 *
 * Both directions and every settlement, because a one-directional, settlement-
 * blind trail is what makes "why?" disagree with the number above it: an expense
 * `from` paid, or a partial settle already recorded, is exactly the reason the
 * suggested amount is smaller than the sum of the rows.
 *
 * A trail whose rows sum to the transfer amount explains it completely; anything
 * left over is simplification (`from` and `to` need share no expense at all) and
 * the UI says so rather than implying the list is the whole story.
 */
function trailFor(expenses: Expenses, settlements: Settlements, from: string, to: string) {
  const rows = expenses.flatMap((e) => {
    // A payer who is not `from` or `to` cannot put the two of them in direct
    // contact, whoever else took a share.
    if (e.payerMemberId !== from && e.payerMemberId !== to) return [];
    const other = e.payerMemberId === to ? from : to;
    const s = e.splits.find((x) => x.memberId === other);
    if (!s || s.amount === 0) return [];
    return [
      {
        kind: "expense" as const,
        id: e.id,
        expenseId: e.id,
        description: e.description,
        at: e.paidAt,
        // `to` paid and `from` took a share: `from` owes it. The other way round
        // it is the same money running the other way, so it subtracts.
        amount: e.payerMemberId === to ? s.amount : -s.amount,
      },
    ];
  });

  // A settlement is money that has already moved, so it cancels exactly as much
  // of the obligation as it was worth. `forgiven` is arithmetically identical.
  const paid = settlements.flatMap((st) => {
    const between =
      (st.fromMemberId === from && st.toMemberId === to) || (st.fromMemberId === to && st.toMemberId === from);
    if (!between || st.amount === 0) return [];
    return [
      {
        kind: "settlement" as const,
        id: st.id,
        expenseId: null,
        description: st.note ?? "",
        at: st.declaredAt,
        amount: st.fromMemberId === from ? -st.amount : st.amount,
      },
    ];
  });

  return [...rows, ...paid].sort((a, b) => b.at - a.at);
}

/** Who owes whom before simplification, settlements included. A simplified
 *  transfer often runs between two people with no shared expense; this is what
 *  makes that one explainable ("you owe B, B owes C"). */
function grossPairs(expenses: Expenses, settlements: Settlements) {
  const acc = new Map<string, Paise>();
  const add = (from: string, to: string, amount: Paise) => {
    // One key per unordered pair, so a settlement running the other way nets
    // against the expenses rather than appearing as a second, opposite debt.
    const flip = from > to;
    const key = flip ? `${to}\u0000${from}` : `${from}\u0000${to}`;
    acc.set(key, (acc.get(key) ?? 0) + (flip ? -amount : amount));
  };

  for (const e of expenses) {
    for (const s of e.splits) {
      if (s.memberId === e.payerMemberId || s.amount === 0) continue;
      add(s.memberId, e.payerMemberId, s.amount);
    }
  }
  for (const st of settlements) add(st.toMemberId, st.fromMemberId, st.amount);

  return [...acc].flatMap(([key, amount]) => {
    if (amount === 0) return [];
    const [a, b] = key.split("\u0000") as [string, string];
    return amount > 0
      ? [{ fromMemberId: a, toMemberId: b, amount }]
      : [{ fromMemberId: b, toMemberId: a, amount: -amount }];
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
      trail: trailFor(expenses, settlements, t.fromMemberId, t.toMemberId),
    })),
    pairs: grossPairs(expenses, settlements),
  });
});

/**
 * Cross-ledger net per friend: ONE number per person, and specifically the one
 * that answers "what do I owe them, everything considered" - the viewer's own
 * obligation to that person, summed over every shared ledger. Positive = that
 * person is owed by the viewer's side.
 *
 * It is deliberately NOT the sum of that person's own net positions. Those
 * include what a THIRD member owes them, which is none of the viewer's business
 * and none of the viewer's money: it made the tab read "you owe Bob ₹30" to
 * someone who owed Bob nothing, and offered a bulk settle that then wrote
 * nothing and left the row exactly where it was.
 *
 * Each ledger contributes the leg of its own transfer plan that runs between the
 * viewer and that person - the same legs bulk settle writes - so this figure is
 * always clearable, and clearing it takes the row to zero.
 *
 * Guests are per-ledger entities with no user and no VPA, so a leg running to a
 * guest cannot be summed into a per-person figure and is left out; it appears in
 * its own ledger's balances, and bulk settle reports it as `skipped`. The viewer
 * is excluded too; their own figure is `net` on each ledger summary.
 *
 * Not ledger-scoped, so it carries requireSession itself.
 */
balances.get("/balances", requireSession, async (c) => {
  const db = c.var.db;
  const viewerId = c.var.user.id;

  const net = new Map<string, Paise>();
  const coMemberIds = new Set<string>();
  for (const { ledger, memberId } of await db.listLedgersForUser(viewerId)) {
    const [members, expenses, settlements] = await Promise.all([
      db.listMembers(ledger.id),
      db.listExpenses(ledger.id),
      db.listSettlements(ledger.id),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const m of members) if (m.userId) coMemberIds.add(m.userId);

    for (const tr of transferPlan(netPositions(expenses, settlements))) {
      const mine = tr.fromMemberId === memberId ? 1 : tr.toMemberId === memberId ? -1 : 0;
      if (mine === 0) continue; // a leg between two other people
      const other = byId.get(mine === 1 ? tr.toMemberId : tr.fromMemberId);
      if (!other?.userId || other.userId === viewerId) continue; // a guest, or a stale id
      net.set(other.userId, (net.get(other.userId) ?? 0) + mine * tr.amount);
    }
  }

  const users = new Map((await db.listUsers()).map((u) => [u.id, u]));
  return c.json(
    [...net].flatMap(([userId, amount]) => {
      const row = users.get(userId);
      if (!row || amount === 0) return [];
      // Everyone here shares a ledger with the viewer by construction, but the
      // VPA decision stays in the serialiser rather than being asserted here.
      const u = serialiseUser(row, coMemberIds.has(userId));
      return [{ userId: u.id, displayName: u.displayName, vpa: u.vpa, net: amount }];
    }),
  );
});

export default balances;

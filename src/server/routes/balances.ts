// Balances are DERIVED on every request - never stored, never cached (ADR 0004,
// SPEC §6). A cached net position that disagrees with expense history is worse
// than a slow query, so there is deliberately no memoisation here.
//
// Mounted at `/api` by the root app; paths below are relative to that.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { grossPairs, netPositions, transferPlan, trailFor } from "~/server/balances";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import type { Paise } from "~/shared/money";
// Agent H owns the user serialiser. VPA is visible only to ledger co-members and
// that rule lives in one place - never spread a user row into a response.
import { serialiseUser } from "~/server/routes/me";

const balances = new Hono<Env>();

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

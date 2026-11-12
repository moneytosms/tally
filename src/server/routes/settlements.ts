// Settlements. The payer declares; the payee is notified, not asked - so the
// balance moves ON DECLARATION and `acknowledgedAt` is a tick, never a gate.
// Nothing in this file reads acknowledgedAt as a precondition.
//
// `upi`, `manual` and `forgiven` are arithmetically identical; `forgiven` is how
// a member with a non-zero position becomes able to leave, recorded rather than
// written off silently.
//
// Mounted at `/api` by the root app; paths below are relative to that.
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "~/db";
import type { Env } from "~/server/context";
import { netPositions, transferPlan } from "~/server/balances";
import { requireMember } from "~/server/middleware/membership";
import { rejectArchivedWrites } from "~/server/routes/expenses";
import { requireSession } from "~/server/middleware/session";
import { notify } from "~/server/routes/push";
import { uuidv7 } from "~/shared/id";
import { formatPaise, type Paise } from "~/shared/money";
import { createSettlementSchema } from "~/shared/schemas";

const settlements = new Hono<Env>();

type Stmt = ReturnType<Db["insertSettlementOnce"]>;

/** Bulk settle clears what the viewer owes across every shared ledger at once.
 *  `toUserId` narrows it to one friend - the UPI-link flow. */
const bulkSchema = z.object({
  toUserId: z.string().min(1).max(64).optional(),
  method: z.enum(["upi", "manual", "forgiven"]),
  note: z.string().trim().max(2000).nullable().default(null),
});

// An archived ledger is READ-ONLY (SPEC §4), and that read-only-ness is the only
// thing keeping "an archived ledger has every net position at zero" (SPEC §12)
// true after the archive check has run. A settlement moves money exactly as an
// expense does, so it goes through the same guard - without it, archiving and
// then settling put an archived ledger permanently out of balance.
settlements.post("/ledgers/:ledgerId/settlements", requireSession, requireMember, rejectArchivedWrites, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = createSettlementSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid settlement", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  if (body.fromMemberId === body.toMemberId) return c.json({ error: "a settlement needs two members" }, 400);

  // requireMember vouches for the caller, not for the ids in the body. Departed members
  // stay settleable (the Settle tab shows their legs); soft-deleted ones do not appear here.
  const live = new Set((await db.listMembersForActivity(ledgerId)).map((m) => m.id));
  if (!live.has(body.fromMemberId) || !live.has(body.toMemberId)) {
    return c.json({ error: "both members must be current members of this ledger" }, 400);
  }

  // A partial settle is first-class, but never more than the payer owes or the payee
  // is owed overall: overshooting flips who owes whom. Applies to every method.
  const [expenses, existing] = await Promise.all([db.listExpenses(ledgerId), db.listSettlements(ledgerId)]);
  const net = new Map(netPositions(expenses, existing).map((p) => [p.memberId, p.net]));
  const bound = Math.min(Math.max(0, -(net.get(body.fromMemberId) ?? 0)), Math.max(0, net.get(body.toMemberId) ?? 0));
  // shortcut: read-then-write, two simultaneous settles can both pass the bound; move the bound into the INSERT's WHERE if that ever happens in practice
  if (body.amount > bound) {
    return c.json({ error: "amount exceeds what is owed", code: "over_settlement" }, 400);
  }

  const id = uuidv7();
  await db.insertSettlement({
    id,
    ledgerId,
    fromMemberId: body.fromMemberId,
    toMemberId: body.toMemberId,
    amount: body.amount,
    method: body.method,
    note: body.note,
    declaredBy: c.var.user.id,
    declaredAt: Date.now(),
  });

  // Trigger 1 of the two push triggers (SPEC §9): the payee is NOTIFIED, not
  // asked - a settlement is declared, never negotiated. Single recipient, and
  // awaited only so a test can observe it; a failure inside notify() is
  // swallowed there and can never fail the settlement itself.
  const payee = (await db.listMembers(ledgerId)).find((m) => m.id === body.toMemberId);
  if (payee?.userId && payee.userId !== c.var.user.id) {
    const ledger = await db.findLedger(ledgerId);
    await notify(c.env, db, payee.userId, {
      title: `${c.var.user.displayName} settled with you`,
      body: `${formatPaise(body.amount)} in ${ledger?.name ?? "a shared ledger"}`,
      url: `/ledgers/${ledgerId}`,
    });
  }

  return c.json({ id }, 201);
});

/** A tick. It changes nothing about the money. */
settlements.post(
  "/ledgers/:ledgerId/settlements/:settlementId/acknowledge",
  requireSession,
  requireMember,
  rejectArchivedWrites,
  async (c) => {
    const db = c.var.db;
    const settlementId = c.req.param("settlementId");
    const row = (await db.listSettlements(c.req.param("ledgerId"))).find((s) => s.id === settlementId);
    if (!row) return c.json({ error: "not found" }, 404);

    const now = Date.now();
    await db.acknowledgeSettlement(settlementId, now);
    return c.json({ id: settlementId, acknowledgedAt: row.acknowledgedAt ?? now });
  },
);

/**
 * Bulk settle: ONE action writing a settlement into EVERY contributing ledger,
 * so each ledger's sum-to-zero invariant still holds afterwards. This is the
 * multi-ledger write that must not half-apply - one db.batch, or nothing.
 *
 * Guests have no VPA, so an obligation running to a guest cannot be part of a
 * UPI push. Those are returned in `skipped` rather than silently dropped, and so
 * is any leg whose member has no live user. Departed members with a user are
 * settled like anyone else, matching the cross-ledger figure on GET /balances.
 *
 * Each write is insertSettlementOnce, so a double tap that plans from the same
 * state writes nothing the second time. Only rows actually written are reported.
 *
 * Not ledger-scoped, so it carries requireSession itself.
 */
settlements.post("/settlements/bulk", requireSession, async (c) => {
  const db = c.var.db;
  const parsed = bulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid bulk settle", detail: parsed.error.issues }, 400);
  const { toUserId, method, note } = parsed.data;

  const now = Date.now();
  const liveUsers = new Set((await db.listUsers()).map((u) => u.id));
  const writes: Stmt[] = [];
  const planned: Array<{ id: string; ledgerId: string; toMemberId: string; amount: Paise }> = [];
  const skipped: Array<{
    ledgerId: string;
    memberId: string;
    guestName: string | null;
    amount: Paise;
    reason: "guest" | "no_user" | "duplicate";
  }> = [];

  for (const { ledger, memberId } of await db.listLedgersForUser(c.var.user.id)) {
    // Read-only, and settled by definition - it has nothing to contribute and
    // must not be written to.
    if (ledger.archivedAt !== null) continue;
    const [members, expenses, existing] = await Promise.all([
      db.listMembersForActivity(ledger.id),
      db.listExpenses(ledger.id),
      db.listSettlements(ledger.id),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));

    for (const tr of transferPlan(netPositions(expenses, existing))) {
      if (tr.fromMemberId !== memberId) continue;
      const payee = byId.get(tr.toMemberId);
      if (toUserId && payee?.userId !== toUserId) continue; // another friend's leg
      // No live user behind this leg: a guest (no VPA), or a member row we cannot
      // resolve. Reported rather than dropped.
      if (!payee?.userId || !liveUsers.has(payee.userId)) {
        skipped.push({
          ledgerId: ledger.id,
          memberId: tr.toMemberId,
          guestName: payee?.guestName ?? null,
          amount: tr.amount,
          reason: payee?.userId === null ? "guest" : "no_user",
        });
        continue;
      }

      const id = uuidv7();
      planned.push({ id, ledgerId: ledger.id, toMemberId: payee.id, amount: tr.amount });
      writes.push(
        db.insertSettlementOnce({
          id,
          ledgerId: ledger.id,
          fromMemberId: memberId,
          toMemberId: payee.id,
          amount: tr.amount,
          method,
          note,
          declaredBy: c.var.user.id,
          declaredAt: now,
        }),
      );
    }
  }

  // One statement per planned leg, same order: meta.changes is 0 for a leg that
  // an identical recent settlement already covered. Such a leg is reported, not dropped.
  const results =
    writes.length > 0 ? ((await db.batch(writes as [Stmt, ...Stmt[]])) as Array<{ meta: { changes: number } }>) : [];
  const created = planned.filter((_, i) => results[i]!.meta.changes > 0);
  planned.forEach((p, i) => {
    if (results[i]!.meta.changes === 0) {
      skipped.push({
        ledgerId: p.ledgerId,
        memberId: p.toMemberId,
        guestName: null,
        amount: p.amount,
        reason: "duplicate",
      });
    }
  });

  return c.json({
    total: created.reduce((a, s) => a + s.amount, 0),
    settlements: created,
    skipped,
  });
});

export default settlements;

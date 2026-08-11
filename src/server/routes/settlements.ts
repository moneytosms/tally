// Settlements. The payer declares; the payee is notified, not asked — so the
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
import { requireSession } from "~/server/middleware/session";
import { uuidv7 } from "~/shared/id";
import type { Paise } from "~/shared/money";
import { createSettlementSchema } from "~/shared/schemas";

const settlements = new Hono<Env>();

type Stmt = ReturnType<Db["insertSettlement"]>;

/** Bulk settle clears what the viewer owes across every shared ledger at once.
 *  `toUserId` narrows it to one friend — the UPI-link flow. */
const bulkSchema = z.object({
  toUserId: z.string().min(1).max(64).optional(),
  method: z.enum(["upi", "manual", "forgiven"]),
  note: z.string().trim().max(2000).nullable().default(null),
});

settlements.post("/ledgers/:ledgerId/settlements", requireSession, requireMember, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = createSettlementSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid settlement", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  if (body.fromMemberId === body.toMemberId) return c.json({ error: "a settlement needs two members" }, 400);

  // requireMember vouches for the caller, not for the ids in the body.
  const live = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  if (!live.has(body.fromMemberId) || !live.has(body.toMemberId)) {
    return c.json({ error: "both members must be current members of this ledger" }, 400);
  }

  // Any positive amount: a partial settle is first-class and need not match a
  // suggested transfer.
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
  return c.json({ id }, 201);
});

/** A tick. It changes nothing about the money. */
settlements.post(
  "/ledgers/:ledgerId/settlements/:settlementId/acknowledge",
  requireSession,
  requireMember,
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
 * multi-ledger write that must not half-apply — one db.batch, or nothing.
 *
 * Guests have no VPA, so an obligation running to a guest cannot be part of a
 * UPI push. Those are returned in `skipped` rather than silently dropped.
 *
 * Not ledger-scoped, so it carries requireSession itself.
 */
settlements.post("/settlements/bulk", requireSession, async (c) => {
  const db = c.var.db;
  const parsed = bulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid bulk settle", detail: parsed.error.issues }, 400);
  const { toUserId, method, note } = parsed.data;

  const now = Date.now();
  const writes: Stmt[] = [];
  const created: Array<{ id: string; ledgerId: string; toMemberId: string; amount: Paise }> = [];
  const skipped: Array<{ ledgerId: string; memberId: string; guestName: string | null; amount: Paise }> = [];

  for (const { ledger, memberId } of await db.listLedgersForUser(c.var.user.id)) {
    const [members, expenses, existing] = await Promise.all([
      db.listMembers(ledger.id),
      db.listExpenses(ledger.id),
      db.listSettlements(ledger.id),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));

    for (const tr of transferPlan(netPositions(expenses, existing))) {
      if (tr.fromMemberId !== memberId) continue;
      const payee = byId.get(tr.toMemberId);
      if (!payee) continue;
      if (!payee.userId) {
        if (!toUserId) skipped.push({ ledgerId: ledger.id, memberId: payee.id, guestName: payee.guestName, amount: tr.amount });
        continue;
      }
      if (toUserId && payee.userId !== toUserId) continue;

      const id = uuidv7();
      created.push({ id, ledgerId: ledger.id, toMemberId: payee.id, amount: tr.amount });
      writes.push(
        db.insertSettlement({
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

  if (writes.length > 0) await db.batch(writes as [Stmt, ...Stmt[]]);

  return c.json({
    total: created.reduce((a, s) => a + s.amount, 0),
    settlements: created,
    skipped,
  });
});

export default settlements;

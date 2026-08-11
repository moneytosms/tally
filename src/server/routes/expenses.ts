// Expenses. Any member may edit or delete any expense (ADR 0005) — the audit
// trail is the control, not the permission, so every edit writes a revision
// snapshot BEFORE it mutates. An edit without a revision is a defect.
//
// Splits are resolved once, at save time, by ~/shared/money and STORED. Nothing
// here recomputes a stored split from its weights.
//
// Mounted at `/api` by the root app; paths below are relative to that and each
// carries its own requireSession + requireMember.
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Env } from "~/server/context";
import type { Db } from "~/db";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { uuidv7 } from "~/shared/id";
import { resolveSplits, type SplitMode } from "~/shared/money";
import { createExpenseSchema, updateExpenseSchema, type CreateExpense } from "~/shared/schemas";

/**
 * An archived ledger is READ-ONLY (SPEC §4) — that is what keeps "a ledger with
 * archived_at set has all balances at zero" (SPEC §12) true after the archive
 * check has run. It is a router-level guard rather than a line in each handler
 * for the same reason soft-delete filtering is structural: a check a handler can
 * forget is a check that will be forgotten.
 *
 * Reads pass through: an archived ledger is still searchable and still feeds
 * analytics. Exported because settlements.ts is the other write path onto a
 * ledger and must route through this exact guard.
 */
export const rejectArchivedWrites: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method !== "GET") {
    const ledgerId = c.req.param("ledgerId");
    const ledger = ledgerId ? await c.var.db.findLedger(ledgerId) : undefined;
    if (ledger?.archivedAt != null) {
      return c.json({ error: "ledger is archived", code: "archived" }, 409);
    }
  }
  await next();
};

const PATH = "/ledgers/:ledgerId/expenses";
const ITEM = `${PATH}/:expenseId` as const;

const expenses = new Hono<Env>();
expenses.use(PATH, requireSession, requireMember, rejectArchivedWrites);
expenses.use(ITEM, requireSession, requireMember, rejectArchivedWrites);

type StoredExpense = NonNullable<Awaited<ReturnType<Db["findExpense"]>>>;

/** Wire shape: `Expense` in src/client/lib/queries.ts, plus each split's raw
 *  input so the editor reopens exactly as the user left it. */
function toWire(e: StoredExpense) {
  return {
    id: e.id,
    ledgerId: e.ledgerId,
    description: e.description,
    total: e.total,
    paidAt: e.paidAt,
    payerMemberId: e.payerMemberId,
    categoryId: e.categoryId,
    notes: e.notes,
    mode: e.mode as SplitMode,
    splits: e.splits.map((s) => ({ memberId: s.memberId, amount: s.amount, inputValue: s.inputValue })),
  };
}

/**
 * requireMember proves the CALLER belongs to this ledger. It says nothing about
 * the ids in the body — a member id from another ledger would otherwise be a
 * silent cross-ledger write.
 */
async function checkMembers(db: Db, ledgerId: string, body: CreateExpense): Promise<string | null> {
  const live = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  if (!live.has(body.payerMemberId)) return "the payer is not a current member of this ledger";
  const seen = new Set<string>();
  for (const p of body.participants) {
    if (!live.has(p.memberId)) return "a participant is not a current member of this ledger";
    if (seen.has(p.memberId)) return "a participant appears twice";
    seen.add(p.memberId);
  }
  return null;
}

/** Participants arrive in stable order (order of addition) and stay in it — the
 *  remainder rule depends on the ordering, so it is never re-sorted. */
function resolve(body: CreateExpense) {
  const payerIndex = body.participants.findIndex((p) => p.memberId === body.payerMemberId);
  return {
    payerIndex,
    // NaN for a missing value is deliberate: resolveSplits rejects it as a
    // non-integer rather than us duplicating its validation here.
    amounts: resolveSplits({
      total: body.total,
      mode: body.mode,
      participantCount: body.participants.length,
      payerIndex,
      values: body.mode === "equal" ? undefined : body.participants.map((p) => p.value ?? Number.NaN),
    }),
  };
}

const splitRows = (expenseId: string, body: CreateExpense, amounts: number[]) =>
  body.participants.map((p, i) => ({
    id: uuidv7(),
    expenseId,
    memberId: p.memberId,
    amount: amounts[i]!,
    inputValue: p.value ?? null,
    sortOrder: i,
  }));

expenses.get(PATH, async (c) => {
  const rows = await c.var.db.listExpenses(c.req.param("ledgerId"));
  return c.json(rows.map(toWire));
});

expenses.post(PATH, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = createExpenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid expense", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  const bad = await checkMembers(db, ledgerId, body);
  if (bad) return c.json({ error: bad }, 400);

  let amounts: number[];
  try {
    ({ amounts } = resolve(body));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const now = Date.now();
  const id = uuidv7();
  // Expense + splits must not half-apply: D1 has no cross-request transaction.
  await db.batch([
    db.insertExpense({
      id,
      ledgerId,
      description: body.description,
      total: body.total,
      paidAt: body.paidAtEpochMs,
      payerMemberId: body.payerMemberId,
      categoryId: body.categoryId,
      notes: body.notes,
      mode: body.mode,
      createdBy: c.var.user.id,
      createdAt: now,
      updatedAt: now,
    }),
    db.insertSplits(splitRows(id, body, amounts)),
  ]);

  const saved = await db.findExpense(ledgerId, id);
  return c.json(toWire(saved!), 201);
});

expenses.patch(ITEM, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  const expenseId = c.req.param("expenseId");

  const prior = await db.findExpense(ledgerId, expenseId);
  if (!prior) return c.json({ error: "not found" }, 404);

  const parsed = updateExpenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid expense", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  const bad = await checkMembers(db, ledgerId, body);
  if (bad) return c.json({ error: bad }, 400);

  let amounts: number[];
  try {
    ({ amounts } = resolve(body));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const now = Date.now();
  // The revision goes in the SAME batch as the mutation. Any member may edit any
  // expense, which is only safe because the before-state survives (ADR 0005).
  await db.batch([
    db.insertRevision({
      id: uuidv7(),
      expenseId,
      snapshot: JSON.stringify(prior),
      revisedBy: c.var.user.id,
      revisedAt: now,
    }),
    db.updateExpense(expenseId, {
      description: body.description,
      total: body.total,
      paidAt: body.paidAtEpochMs,
      payerMemberId: body.payerMemberId,
      categoryId: body.categoryId,
      notes: body.notes,
      mode: body.mode,
      updatedAt: now,
    }),
    db.clearSplits(expenseId),
    db.insertSplits(splitRows(expenseId, body, amounts)),
  ]);

  const saved = await db.findExpense(ledgerId, expenseId);
  return c.json(toWire(saved!));
});

expenses.delete(ITEM, async (c) => {
  const db = c.var.db;
  const expenseId = c.req.param("expenseId");
  const prior = await db.findExpense(c.req.param("ledgerId"), expenseId);
  if (!prior) return c.json({ error: "not found" }, 404);

  const now = Date.now();
  // Soft delete only. The row and its splits stay, and a revision records who.
  await db.batch([
    db.insertRevision({
      id: uuidv7(),
      expenseId,
      snapshot: JSON.stringify(prior),
      revisedBy: c.var.user.id,
      revisedAt: now,
    }),
    db.softDeleteExpense(expenseId, now),
  ]);
  return c.json({ id: expenseId, deletedAt: now });
});

export default expenses;

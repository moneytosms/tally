// Recurring series CRUD. Generation itself lives in ~/server/recurring and is
// driven by the alarm in ~/server/recurring-do.
//
// SPEC §9: "Editing a series affects future occurrences only." Nothing here
// touches an already-generated expense — an occurrence, once written, is an
// ordinary expense that any member may edit or delete like any other.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { pokeRecurring } from "~/server/recurring-do";
import { rejectArchivedWrites } from "~/server/routes/expenses";
import { uuidv7 } from "~/shared/id";
import { nextOccurrence } from "~/shared/recurrence";
import { createSeriesSchema } from "~/shared/schemas";

const PATH = "/ledgers/:ledgerId/recurring";
const ITEM = `${PATH}/:seriesId` as const;

const recurring = new Hono<Env>();
recurring.use(PATH, requireSession, requireMember, rejectArchivedWrites);
recurring.use(ITEM, requireSession, requireMember, rejectArchivedWrites);
recurring.use(`${ITEM}/*`, requireSession, requireMember, rejectArchivedWrites);

type Row = Awaited<ReturnType<NonNullable<Env["Variables"]["db"]>["findSeries"]>>;

function toWire(s: NonNullable<Row>) {
  return {
    id: s.id,
    ledgerId: s.ledgerId,
    description: s.description,
    total: s.total,
    payerMemberId: s.payerMemberId,
    categoryId: s.categoryId,
    notes: s.notes,
    mode: s.mode,
    participants: JSON.parse(s.splitTemplate) as Array<{ memberId: string; value?: number }>,
    intervalUnit: s.intervalUnit,
    intervalCount: s.intervalCount,
    startAt: s.startAt,
    endAt: s.endAt,
    nextOccurrenceAt: s.nextOccurrenceAt,
    pausedAt: s.pausedAt,
  };
}

recurring.get(PATH, async (c) => {
  const rows = await c.var.db.listSeries(c.req.param("ledgerId"));
  return c.json(rows.map(toWire));
});

recurring.post(PATH, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = createSeriesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid series", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  // Same cross-ledger guard the expense routes apply: requireMember proves the
  // CALLER belongs here, not the member ids in the body.
  const live = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  if (!live.has(body.payerMemberId)) return c.json({ error: "the payer is not a current member of this ledger" }, 400);
  const seen = new Set<string>();
  for (const p of body.participants) {
    if (!live.has(p.memberId)) return c.json({ error: "a participant is not a current member of this ledger" }, 400);
    if (seen.has(p.memberId)) return c.json({ error: "a participant appears twice" }, 400);
    seen.add(p.memberId);
  }

  const id = uuidv7();
  await db.insertSeries({
    id,
    ledgerId,
    description: body.description,
    total: body.total,
    payerMemberId: body.payerMemberId,
    categoryId: body.categoryId,
    notes: body.notes,
    mode: body.mode,
    splitTemplate: JSON.stringify(body.participants),
    intervalUnit: body.intervalUnit,
    intervalCount: body.intervalCount,
    startAt: body.startAt,
    endAt: body.endAt,
    // The first occurrence is the start itself, so a series dated in the past
    // back-fills on the next alarm rather than silently losing those months.
    nextOccurrenceAt: body.startAt,
    createdBy: c.var.user.id,
    createdAt: Date.now(),
    pausedAt: null,
    deletedAt: null,
  });

  await pokeRecurring(c.env.RECURRING);
  const saved = await db.findSeries(id);
  return c.json(toWire(saved!), 201);
});

recurring.patch(ITEM, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  const seriesId = c.req.param("seriesId");

  const existing = await db.findSeries(seriesId);
  if (!existing || existing.ledgerId !== ledgerId) return c.json({ error: "not found" }, 404);

  const parsed = createSeriesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid series", detail: parsed.error.issues }, 400);
  const body = parsed.data;

  const live = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  if (!live.has(body.payerMemberId)) return c.json({ error: "the payer is not a current member of this ledger" }, 400);
  for (const p of body.participants) {
    if (!live.has(p.memberId)) return c.json({ error: "a participant is not a current member of this ledger" }, 400);
  }

  // Future occurrences only: the cursor moves forward to the next instant of the
  // NEW cadence, and everything already generated is left exactly as it is.
  const cursor =
    body.startAt > existing.nextOccurrenceAt
      ? body.startAt
      : nextOccurrence(
          { startAt: body.startAt, intervalUnit: body.intervalUnit, intervalCount: body.intervalCount, endAt: body.endAt },
          Date.now(),
        );

  await db.updateSeries(seriesId, {
    description: body.description,
    total: body.total,
    payerMemberId: body.payerMemberId,
    categoryId: body.categoryId,
    notes: body.notes,
    mode: body.mode,
    splitTemplate: JSON.stringify(body.participants),
    intervalUnit: body.intervalUnit,
    intervalCount: body.intervalCount,
    startAt: body.startAt,
    endAt: body.endAt,
    nextOccurrenceAt: cursor,
  });

  await pokeRecurring(c.env.RECURRING);
  return c.json(toWire((await db.findSeries(seriesId))!));
});

recurring.post(`${ITEM}/pause`, async (c) => {
  const db = c.var.db;
  const seriesId = c.req.param("seriesId");
  const existing = await db.findSeries(seriesId);
  if (!existing || existing.ledgerId !== c.req.param("ledgerId")) return c.json({ error: "not found" }, 404);

  const pausedAt = existing.pausedAt === null ? Date.now() : null;
  // Resuming does NOT rewind the cursor: a series paused for three months
  // generates from today, not three months of back-dated rent nobody agreed to.
  const patch = pausedAt === null ? { pausedAt, nextOccurrenceAt: Math.max(existing.nextOccurrenceAt, Date.now()) } : { pausedAt };
  await db.updateSeries(seriesId, patch);

  await pokeRecurring(c.env.RECURRING);
  return c.json(toWire((await db.findSeries(seriesId))!));
});

recurring.delete(ITEM, async (c) => {
  const db = c.var.db;
  const seriesId = c.req.param("seriesId");
  const existing = await db.findSeries(seriesId);
  if (!existing || existing.ledgerId !== c.req.param("ledgerId")) return c.json({ error: "not found" }, 404);

  // Occurrences already generated stay. They are real expenses that real people
  // already settled around; deleting the template is not deleting the history.
  await db.softDeleteSeries(seriesId, Date.now());
  await pokeRecurring(c.env.RECURRING);
  return c.json({ id: seriesId });
});

export default recurring;

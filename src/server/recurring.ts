// Generating expenses from a recurring series.
//
// SPEC §11 hazard 5: a retry must never double-create. Three things guarantee
// that, in order of how much they are trusted:
//
//   1. The occurrence sequence is a pure function of the cadence
//      (~/shared/recurrence), so a replay asks for the same instants.
//   2. This module reads back which instants already exist and skips them.
//   3. A unique index on (series_id, occurrence_at) rejects anything that gets
//      past (2) — a crash between the insert and the cursor advance, or two
//      alarms racing. The database is the authority; the check above it is only
//      there to keep the happy path from throwing.
//
// Splits are re-resolved per occurrence rather than copied, so the remainder
// rule applies to each one exactly as it would to a hand-entered expense
// (CONTEXT.md, "Remainder"). Copying resolved amounts would silently give the
// same participant the odd paise every single month.
import type { Db } from "~/db";
import type { recurringSeries } from "~/db/schema";
import { uuidv7 } from "~/shared/id";
import { resolveSplits, type SplitMode } from "~/shared/money";
import { nextOccurrence, occurrencesDue, type Cadence } from "~/shared/recurrence";

export type Series = typeof recurringSeries.$inferSelect;

/** One entry per participant, in stable order. `value` is per mode: exact paise,
 *  share weight, or percent — absent for `equal`. */
export type SplitTemplateEntry = { memberId: string; value?: number };

export function parseSplitTemplate(json: string): SplitTemplateEntry[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("split template is not an array");
  return parsed as SplitTemplateEntry[];
}

export const cadenceOf = (s: Series): Cadence => ({
  startAt: s.startAt,
  intervalUnit: s.intervalUnit as Cadence["intervalUnit"],
  intervalCount: s.intervalCount,
  endAt: s.endAt,
});

export type CatchUpResult = {
  created: number[]; // occurrence instants actually written
  skipped: number[]; // instants that already existed
  /** The series' new cursor. Persisted by the caller. */
  cursor: number;
  /** True when the cap was hit and more work remains right now. */
  more: boolean;
};

const BATCH_CAP = 50;

/**
 * Generate every occurrence a series owes at `now`.
 *
 * Members who have left the ledger are dropped from the split before it is
 * resolved — a series outlives its participants, and charging someone who left
 * would break "a member with a non-zero balance cannot have left_at set"
 * (SPEC §12). If the payer has left, or fewer than one participant remains, the
 * occurrence is skipped rather than guessed at.
 */
export async function runCatchUp(db: Db, series: Series, now: number): Promise<CatchUpResult> {
  const cadence = cadenceOf(series);
  const due = occurrencesDue(cadence, series.nextOccurrenceAt, now, BATCH_CAP);
  if (due.length === 0) {
    return { created: [], skipped: [], cursor: series.nextOccurrenceAt, more: false };
  }

  const already = new Set(await db.listSeriesOccurrences(series.id));
  const live = new Set((await db.listMembers(series.ledgerId)).map((m) => m.id));
  const template = parseSplitTemplate(series.splitTemplate).filter((p) => live.has(p.memberId));

  const created: number[] = [];
  const skipped: number[] = [];

  for (const at of due) {
    if (already.has(at)) {
      skipped.push(at);
      continue;
    }
    if (!live.has(series.payerMemberId) || template.length === 0) {
      // Nothing sane to write. Still counted as handled so the cursor advances
      // past it — otherwise the series wedges and retries forever.
      skipped.push(at);
      continue;
    }

    const payerIndex = template.findIndex((p) => p.memberId === series.payerMemberId);
    let amounts: number[];
    try {
      amounts = resolveSplits({
        total: series.total,
        mode: series.mode as SplitMode,
        participantCount: template.length,
        payerIndex,
        values: series.mode === "equal" ? undefined : template.map((p) => p.value ?? Number.NaN),
      });
    } catch {
      // A template that no longer resolves (an `exact` split whose amounts no
      // longer sum to the total after someone left) is skipped, not guessed.
      skipped.push(at);
      continue;
    }

    const id = uuidv7();
    try {
      await db.batch([
        db.insertExpense({
          id,
          ledgerId: series.ledgerId,
          description: series.description,
          total: series.total,
          paidAt: at,
          payerMemberId: series.payerMemberId,
          categoryId: series.categoryId,
          notes: series.notes,
          mode: series.mode,
          createdBy: series.createdBy,
          createdAt: now,
          updatedAt: now,
          seriesId: series.id,
          occurrenceAt: at,
        }),
        db.insertSplits(
          template.map((p, i) => ({
            id: uuidv7(),
            expenseId: id,
            memberId: p.memberId,
            amount: amounts[i]!,
            inputValue: p.value ?? null,
            sortOrder: i,
          })),
        ),
      ]);
      created.push(at);
    } catch (e) {
      // The unique index did its job: another invocation already wrote this
      // instant. That is the expected outcome of a retry, not an error.
      if (isUniqueViolation(e)) skipped.push(at);
      else throw e;
    }
  }

  const last = due[due.length - 1]!;
  const cursor = nextOccurrence(cadence, last);
  return { created, skipped, cursor, more: due.length === BATCH_CAP };
}

/** D1 and node:sqlite word this differently; both mention the constraint. */
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

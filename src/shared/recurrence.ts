// Recurrence arithmetic. Pure, deterministic, no I/O and no `Date.now()` -
// every function takes the current time as an argument so catch-up after
// downtime replays identically in a test and in production.
//
// SPEC §11 hazard 5: "Recurring catch-up must be idempotent. A retry must never
// double-create." Idempotency is ultimately enforced by a unique index on
// (series_id, occurrence_at) in the database. This module's contribution is that
// the occurrence SEQUENCE is a pure function of (startAt, unit, count) - the
// same series always produces the same instants, so a replay collides with the
// existing rows instead of landing between them.

export type IntervalUnit = "day" | "week" | "month";

export type Cadence = {
  startAt: number; // epoch ms - the first occurrence
  intervalUnit: IntervalUnit;
  intervalCount: number; // >= 1
  endAt: number | null; // epoch ms, exclusive bound; null runs forever
};

const DAY_MS = 86_400_000;

/**
 * The occurrence strictly after `from`.
 *
 * Day and week are fixed-length steps from `startAt`, computed by multiplication
 * rather than repeated addition so a long outage costs one operation.
 *
 * Month is calendar arithmetic in UTC, and is deliberately clamped: a series
 * starting on the 31st falls to the 30th, or to the 28th/29th in February,
 * rather than overflowing into the next month the way `setUTCMonth` does on its
 * own. The anchor day is always taken from `startAt`, never from the previous
 * occurrence, so a clamped month does not permanently drag the series earlier -
 * Jan 31 → Feb 28 → Mar 31, not Feb 28 → Mar 28.
 */
export function nextOccurrence(cadence: Cadence, from: number): number {
  const { startAt, intervalUnit, intervalCount } = cadence;
  if (from < startAt) return startAt;

  if (intervalUnit === "month") {
    const anchor = new Date(startAt);
    const anchorDay = anchor.getUTCDate();
    const elapsedMonths =
      (new Date(from).getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      (new Date(from).getUTCMonth() - anchor.getUTCMonth());
    // Round down to a whole number of intervals, then step forward until we are
    // strictly past `from`. At most two iterations - the clamp can only pull an
    // occurrence back within its own month.
    let steps = Math.floor(elapsedMonths / intervalCount) * intervalCount;
    for (;;) {
      const at = addMonths(anchor, steps, anchorDay);
      if (at > from) return at;
      steps += intervalCount;
    }
  }

  const step = (intervalUnit === "week" ? 7 : 1) * intervalCount * DAY_MS;
  const elapsed = from - startAt;
  return startAt + (Math.floor(elapsed / step) + 1) * step;
}

/** `base` plus `months` calendar months in UTC, with the day-of-month clamped to
 *  the target month's length. Keeps the wall-clock time of day from `base`. */
function addMonths(base: Date, months: number, anchorDay: number): number {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  // Day 0 of the following month is the last day of this one.
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(anchorDay, daysInTarget),
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds(),
  );
}

/**
 * Every occurrence owed at `now`, starting from `cursor` (inclusive).
 *
 * `cursor` is the series' stored `nextOccurrenceAt`. Advancing it is what makes
 * the common path cheap; the unique index is what makes a crash between
 * generating and advancing harmless.
 *
 * `limit` caps a single catch-up so a series dormant for years cannot blow the
 * 10 ms CPU ceiling in one invocation (CLAUDE.md). Hitting the cap is not an
 * error - the caller reschedules immediately and drains the rest.
 */
export function occurrencesDue(cadence: Cadence, cursor: number, now: number, limit = 50): number[] {
  const out: number[] = [];
  let at = Math.max(cursor, cadence.startAt);
  while (at <= now && out.length < limit) {
    if (cadence.endAt !== null && at >= cadence.endAt) break;
    out.push(at);
    at = nextOccurrence(cadence, at);
  }
  return out;
}

/**
 * When the alarm should next fire, or null when the series is finished.
 * Null means "cancel the alarm" - an ended series must not hold a live timer.
 */
export function nextAlarmAt(cadence: Cadence, cursor: number): number | null {
  const at = Math.max(cursor, cadence.startAt);
  if (cadence.endAt !== null && at >= cadence.endAt) return null;
  return at;
}

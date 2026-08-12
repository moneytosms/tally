// SPEC §11 hazard 5. The property that matters is idempotency: replaying a
// catch-up over an interval already covered must produce the SAME instants, so
// the unique index on (series_id, occurrence_at) rejects the duplicates rather
// than the series drifting and creating rows that slip past it.
import { describe, expect, it } from "vitest";
import { nextAlarmAt, nextOccurrence, occurrencesDue, type Cadence } from "~/shared/recurrence";

const utc = (s: string) => Date.parse(s);

const daily = (startAt: number, count = 1, endAt: number | null = null): Cadence => ({
  startAt,
  intervalUnit: "day",
  intervalCount: count,
  endAt,
});
const monthly = (startAt: number, count = 1, endAt: number | null = null): Cadence => ({
  startAt,
  intervalUnit: "month",
  intervalCount: count,
  endAt,
});

describe("nextOccurrence", () => {
  it("returns the start when asked from before it", () => {
    const start = utc("2026-03-01T09:00:00Z");
    expect(nextOccurrence(daily(start), utc("2026-01-01T00:00:00Z"))).toBe(start);
  });

  it("steps by whole days and keeps the time of day", () => {
    const start = utc("2026-03-01T09:00:00Z");
    expect(nextOccurrence(daily(start), start)).toBe(utc("2026-03-02T09:00:00Z"));
  });

  it("steps by an interval count greater than one", () => {
    const start = utc("2026-03-01T09:00:00Z");
    expect(nextOccurrence(daily(start, 3), start)).toBe(utc("2026-03-04T09:00:00Z"));
  });

  it("steps weekly", () => {
    const start = utc("2026-03-02T09:00:00Z"); // a Monday
    const c: Cadence = { startAt: start, intervalUnit: "week", intervalCount: 2, endAt: null };
    expect(nextOccurrence(c, start)).toBe(utc("2026-03-16T09:00:00Z"));
  });

  it("jumps a long outage in one step rather than iterating", () => {
    const start = utc("2020-01-01T00:00:00Z");
    const from = utc("2026-08-11T00:00:00Z");
    const next = nextOccurrence(daily(start), from);
    expect(next).toBe(utc("2026-08-12T00:00:00Z"));
  });

  it("steps monthly on a stable day", () => {
    const start = utc("2026-01-15T08:30:00Z");
    expect(nextOccurrence(monthly(start), start)).toBe(utc("2026-02-15T08:30:00Z"));
  });

  // The classic calendar bug: setUTCMonth on Jan 31 rolls into March.
  it("clamps a 31st into a short month instead of overflowing", () => {
    const start = utc("2026-01-31T00:00:00Z");
    expect(nextOccurrence(monthly(start), start)).toBe(utc("2026-02-28T00:00:00Z"));
  });

  it("recovers the anchor day after a clamped month", () => {
    const start = utc("2026-01-31T00:00:00Z");
    const feb = nextOccurrence(monthly(start), start);
    // Anchored on startAt, not on the clamped previous occurrence - so March is
    // the 31st again, not the 28th.
    expect(nextOccurrence(monthly(start), feb)).toBe(utc("2026-03-31T00:00:00Z"));
  });

  it("clamps to 29 February in a leap year", () => {
    const start = utc("2024-01-31T00:00:00Z"); // 2024 is a leap year
    expect(nextOccurrence(monthly(start), start)).toBe(utc("2024-02-29T00:00:00Z"));
  });

  it("is strictly increasing - never returns the instant it was given", () => {
    const start = utc("2026-01-31T00:00:00Z");
    let at = start;
    for (let i = 0; i < 40; i++) {
      const next = nextOccurrence(monthly(start), at);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });
});

describe("occurrencesDue", () => {
  it("returns nothing when the first occurrence is still in the future", () => {
    const start = utc("2026-09-01T00:00:00Z");
    expect(occurrencesDue(daily(start), start, utc("2026-08-11T00:00:00Z"))).toEqual([]);
  });

  it("returns the occurrences owed after an outage", () => {
    const start = utc("2026-08-01T00:00:00Z");
    const due = occurrencesDue(daily(start), start, utc("2026-08-04T12:00:00Z"));
    expect(due).toEqual([
      utc("2026-08-01T00:00:00Z"),
      utc("2026-08-02T00:00:00Z"),
      utc("2026-08-03T00:00:00Z"),
      utc("2026-08-04T00:00:00Z"),
    ]);
  });

  // The idempotency property, stated directly.
  it("replays identically from the same cursor", () => {
    const start = utc("2026-08-01T00:00:00Z");
    const now = utc("2026-08-05T00:00:00Z");
    const first = occurrencesDue(daily(start), start, now);
    const replay = occurrencesDue(daily(start), start, now);
    expect(replay).toEqual(first);
  });

  it("yields nothing more once the cursor has advanced past now", () => {
    const start = utc("2026-08-01T00:00:00Z");
    const now = utc("2026-08-05T00:00:00Z");
    const due = occurrencesDue(daily(start), start, now);
    const cursor = nextOccurrence(daily(start), due[due.length - 1]!);
    expect(occurrencesDue(daily(start), cursor, now)).toEqual([]);
  });

  it("stops at endAt, which is exclusive", () => {
    const start = utc("2026-08-01T00:00:00Z");
    const end = utc("2026-08-03T00:00:00Z");
    const due = occurrencesDue(daily(start, 1, end), start, utc("2026-08-10T00:00:00Z"));
    expect(due).toEqual([utc("2026-08-01T00:00:00Z"), utc("2026-08-02T00:00:00Z")]);
  });

  it("caps a very long dormancy so one invocation cannot blow the CPU ceiling", () => {
    const start = utc("2020-01-01T00:00:00Z");
    const due = occurrencesDue(daily(start), start, utc("2026-08-11T00:00:00Z"), 50);
    expect(due).toHaveLength(50);
    // and the run is resumable: the next cursor continues where this stopped
    const cursor = nextOccurrence(daily(start), due[49]!);
    expect(cursor).toBe(utc("2020-02-20T00:00:00Z"));
  });

  it("generates monthly occurrences across a year boundary", () => {
    const start = utc("2026-11-15T00:00:00Z");
    const due = occurrencesDue(monthly(start), start, utc("2027-02-01T00:00:00Z"));
    expect(due).toEqual([
      utc("2026-11-15T00:00:00Z"),
      utc("2026-12-15T00:00:00Z"),
      utc("2027-01-15T00:00:00Z"),
    ]);
  });
});

describe("nextAlarmAt", () => {
  it("is the cursor while the series is live", () => {
    const start = utc("2026-08-01T00:00:00Z");
    expect(nextAlarmAt(daily(start), start)).toBe(start);
  });

  it("is null once the cursor reaches endAt, so the alarm is cancelled", () => {
    const start = utc("2026-08-01T00:00:00Z");
    const end = utc("2026-08-03T00:00:00Z");
    expect(nextAlarmAt(daily(start, 1, end), end)).toBeNull();
  });

  it("never returns an instant before the series starts", () => {
    const start = utc("2026-09-01T00:00:00Z");
    expect(nextAlarmAt(daily(start), 0)).toBe(start);
  });
});

// SPEC §11 hazard 5. The headline assertion is that running catch-up twice over
// the same interval creates the occurrences once - everything else here exists
// to make sure that stays true when the ledger changes underneath the series.
//
// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import { runCatchUp, type Series } from "~/server/recurring";
import { type Harness, setup } from "~/server/routes/_test-harness";
import { uuidv7 } from "~/shared/id";

let h: Harness;

beforeEach(async () => {
  h = await setup();
});

const utc = (s: string) => Date.parse(s);
const START = utc("2026-08-01T00:00:00Z");

/** Insert a series directly - the HTTP route is covered in recurring.routes.test.ts. */
function makeSeries(over: Partial<Series> = {}): Series {
  const s: Series = {
    id: uuidv7(),
    ledgerId: "L1",
    description: "Broadband",
    total: 120000, // ₹1,200
    payerMemberId: "m_ada",
    categoryId: "cat_utilities",
    notes: null,
    mode: "equal",
    splitTemplate: JSON.stringify([{ memberId: "m_ada" }, { memberId: "m_bob" }]),
    intervalUnit: "month",
    intervalCount: 1,
    startAt: START,
    endAt: null,
    nextOccurrenceAt: START,
    createdBy: "u_ada",
    createdAt: START,
    pausedAt: null,
    deletedAt: null,
    ...over,
  };
  h.sql
    .prepare(
      `INSERT INTO recurring_series (id, ledger_id, description, total, payer_member_id, category_id, notes, mode,
        split_template, interval_unit, interval_count, start_at, end_at, next_occurrence_at, created_by, created_at,
        paused_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      s.id, s.ledgerId, s.description, s.total, s.payerMemberId, s.categoryId, s.notes, s.mode,
      s.splitTemplate, s.intervalUnit, s.intervalCount, s.startAt, s.endAt, s.nextOccurrenceAt,
      s.createdBy, s.createdAt, s.pausedAt, s.deletedAt,
    );
  return s;
}

const expenseCount = (seriesId: string) =>
  (h.sql.prepare("SELECT count(*) c FROM expenses WHERE series_id = ?").all(seriesId) as [{ c: number }])[0].c;

describe("runCatchUp", () => {
  it("creates nothing before the first occurrence is due", async () => {
    const s = makeSeries();
    const r = await runCatchUp(h.db, s, utc("2026-07-30T00:00:00Z"));
    expect(r.created).toEqual([]);
    expect(expenseCount(s.id)).toBe(0);
  });

  it("creates one expense per due occurrence and resolves its splits", async () => {
    const s = makeSeries();
    const r = await runCatchUp(h.db, s, utc("2026-10-05T00:00:00Z"));
    // Aug, Sep, Oct
    expect(r.created).toHaveLength(3);
    expect(expenseCount(s.id)).toBe(3);

    const splits = h.sql
      .prepare(
        "SELECT s.amount FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.series_id = ? ORDER BY e.paid_at, s.sort_order",
      )
      .all(s.id) as Array<{ amount: number }>;
    // ₹1,200 split two ways, every month
    expect(splits.slice(0, 2).map((x) => x.amount)).toEqual([60000, 60000]);
    expect(splits.reduce((a, x) => a + x.amount, 0)).toBe(360000); // 3 × ₹1,200
  });

  // The hazard, stated directly.
  it("is idempotent - a replay from the same cursor creates nothing new", async () => {
    const s = makeSeries();
    const now = utc("2026-10-05T00:00:00Z");

    const first = await runCatchUp(h.db, s, now);
    expect(first.created).toHaveLength(3);

    // The cursor was never persisted - exactly what a crash after the inserts
    // but before the update looks like.
    const replay = await runCatchUp(h.db, s, now);
    expect(replay.created).toEqual([]);
    expect(replay.skipped).toHaveLength(3);
    expect(expenseCount(s.id)).toBe(3);
  });

  it("advances the cursor so the next run does no work", async () => {
    const s = makeSeries();
    const now = utc("2026-10-05T00:00:00Z");
    const first = await runCatchUp(h.db, s, now);
    const second = await runCatchUp(h.db, { ...s, nextOccurrenceAt: first.cursor }, now);
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual([]);
  });

  it("does not recreate an occurrence the user deleted", async () => {
    const s = makeSeries();
    await runCatchUp(h.db, s, utc("2026-09-05T00:00:00Z"));
    expect(expenseCount(s.id)).toBe(2);

    h.sql.prepare("UPDATE expenses SET deleted_at = ? WHERE series_id = ?").run(START, s.id);
    // Replaying from the original cursor must respect the deletion: "not this
    // one" is a decision, and catch-up is not entitled to overrule it.
    const replay = await runCatchUp(h.db, s, utc("2026-09-05T00:00:00Z"));
    expect(replay.created).toEqual([]);
    expect(expenseCount(s.id)).toBe(2);
  });

  it("stops at endAt", async () => {
    const s = makeSeries({ endAt: utc("2026-10-01T00:00:00Z") });
    const r = await runCatchUp(h.db, s, utc("2026-12-01T00:00:00Z"));
    // Aug and Sep only - endAt is exclusive.
    expect(r.created).toHaveLength(2);
  });

  it("drops a participant who left the ledger and re-splits the remainder", async () => {
    const s = makeSeries({
      splitTemplate: JSON.stringify([{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }]),
    });
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(START, "m_guest");

    await runCatchUp(h.db, s, utc("2026-08-05T00:00:00Z"));
    const splits = h.sql
      .prepare("SELECT s.member_id, s.amount FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.series_id = ?")
      .all(s.id) as Array<{ member_id: string; amount: number }>;
    expect(splits).toHaveLength(2);
    expect(splits.map((x) => x.member_id).sort()).toEqual(["m_ada", "m_bob"]);
    expect(splits.reduce((a, x) => a + x.amount, 0)).toBe(120000); // still exactly ₹1,200
  });

  it("skips rather than guesses when the payer has left", async () => {
    const s = makeSeries();
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(START, "m_ada");
    const r = await runCatchUp(h.db, s, utc("2026-08-05T00:00:00Z"));
    expect(r.created).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(expenseCount(s.id)).toBe(0);
    // and the cursor still advanced, so the series does not wedge
    expect(r.cursor).toBeGreaterThan(s.nextOccurrenceAt);
  });

  it("splits sum to the total exactly when the division is uneven", async () => {
    const s = makeSeries({
      total: 100001, // ₹1,000.01 - does not divide by 3
      splitTemplate: JSON.stringify([{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }]),
    });
    await runCatchUp(h.db, s, utc("2026-08-05T00:00:00Z"));
    const [{ total }] = h.sql
      .prepare("SELECT sum(s.amount) total FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.series_id = ?")
      .all(s.id) as [{ total: number }];
    expect(total).toBe(100001);
  });

  it("caps one run and reports that more work remains", async () => {
    const s = makeSeries({ intervalUnit: "day", intervalCount: 1 });
    const r = await runCatchUp(h.db, s, utc("2027-08-01T00:00:00Z"));
    expect(r.created).toHaveLength(50);
    expect(r.more).toBe(true);

    // Draining continues from the reported cursor rather than starting over.
    const next = await runCatchUp(h.db, { ...s, nextOccurrenceAt: r.cursor }, utc("2027-08-01T00:00:00Z"));
    expect(next.created).toHaveLength(50);
    expect(next.created[0]).toBe(r.cursor);
  });
});

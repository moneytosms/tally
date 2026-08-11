// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import expensesRouter from "~/server/routes/expenses";
import insightsRouter from "~/server/routes/insights";
import { type Harness, NOW, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expensesRouter, insightsRouter);
});

type Insights = {
  totals: { spent: number; paid: number; expenseCount: number; ledgerCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: number; count: number }>;
  byMonth: Array<{ month: string; spent: number }>;
  mostSpentWith: Array<{ userId: string; displayName: string; sharedExpenseCount: number; sharedTotal: number }>;
};

const expense = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: { description: "x", paidAtEpochMs: NOW, categoryId: null, notes: null, mode: "equal", ...body },
    }),
  );

const insights = async (qs = "") =>
  (await (await app.request(req(h, `/api/insights${qs}`))).json()) as Insights;

describe("GET /insights", () => {
  it("sums only the caller's own shares into totals.spent", async () => {
    // ₹100.00 total, Ada's share is ₹50.00
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] });

    const i = await insights();
    expect(i.totals.spent).toBe(5_000); // ₹50.00, not the ₹100.00 total
    expect(i.totals.expenseCount).toBe(1);
  });

  it("counts totals.paid for expenses the caller paid, even ones they didn't split", async () => {
    // Ada pays for Bob and the guest only — Ada is not a participant.
    await expense("L1", { total: 8_000, payerMemberId: "m_ada", participants: [{ memberId: "m_bob" }, { memberId: "m_guest" }] }); // ₹80.00

    const i = await insights();
    expect(i.totals.paid).toBe(8_000);
    expect(i.totals.spent).toBe(0); // not a participant, so no share
  });

  it("orders byCategory by spent descending and collapses uncategorised", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_ada", categoryId: "cat_food", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // Ada: ₹50.00
    await expense("L1", { total: 20_000, payerMemberId: "m_ada", categoryId: "cat_transport", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // Ada: ₹100.00
    await expense("L1", { total: 4_000, payerMemberId: "m_ada", categoryId: null, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // Ada: ₹20.00

    const i = await insights();
    expect(i.byCategory.map((c) => c.categoryId)).toEqual(["cat_transport", "cat_food", null]);
    expect(i.byCategory.find((c) => c.categoryId === null)).toMatchObject({ name: "Uncategorised", spent: 2_000, count: 1 });
    expect(i.byCategory.find((c) => c.categoryId === "cat_food")).toMatchObject({ name: "Food & Drink", spent: 5_000 });
  });

  it("fills a gap month with 0, ascending", async () => {
    const jan = Date.UTC(2026, 0, 15);
    const apr = Date.UTC(2026, 3, 15);
    await expense("L1", { total: 2_000, paidAtEpochMs: jan, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] }); // ₹20.00
    await expense("L1", { total: 4_000, paidAtEpochMs: apr, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] }); // ₹40.00

    const i = await insights();
    expect(i.byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(i.byMonth.map((m) => m.spent)).toEqual([2_000, 0, 0, 4_000]);
  });

  it("ranks mostSpentWith by sharedTotal and excludes the guest", async () => {
    // Ada shares two expenses with Bob, one with the guest.
    await expense("L1", { total: 10_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // Ada: ₹50.00
    await expense("L1", { total: 6_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // Ada: ₹30.00
    await expense("L1", { total: 4_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }] }); // Ada: ₹20.00

    const i = await insights();
    expect(i.mostSpentWith).toEqual([{ userId: "u_bob", displayName: "Bob", sharedExpenseCount: 2, sharedTotal: 8_000 }]);
  });

  it("excludes a soft-deleted expense from every figure", async () => {
    const { id } = (await (
      await expense("L1", { total: 10_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹50.00
    ).json()) as { id: string };
    await expense("L1", { total: 2_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹10.00

    await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));

    const i = await insights();
    expect(i.totals.spent).toBe(1_000); // only the ₹2,000 (₹10.00) expense
    expect(i.totals.expenseCount).toBe(1);
    expect(i.mostSpentWith).toEqual([{ userId: "u_bob", displayName: "Bob", sharedExpenseCount: 1, sharedTotal: 1_000 }]);
  });

  it("returns zeros and empty arrays for a user with no expenses", async () => {
    const i = await insights();
    expect(i).toEqual({
      totals: { spent: 0, paid: 0, expenseCount: 0, ledgerCount: 0 },
      byCategory: [],
      byMonth: [],
      mostSpentWith: [],
    });
  });

  it("`from` excludes older expenses", async () => {
    const jan = Date.UTC(2026, 0, 15);
    const mar = Date.UTC(2026, 2, 15);
    await expense("L1", { total: 2_000, paidAtEpochMs: jan, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] }); // ₹20.00
    await expense("L1", { total: 4_000, paidAtEpochMs: mar, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] }); // ₹40.00

    const i = await insights(`?from=${Date.UTC(2026, 1, 1)}`);
    expect(i.totals.spent).toBe(4_000);
    expect(i.byMonth).toEqual([{ month: "2026-03", spent: 4_000 }]);
  });

  it("401s without a session", async () => {
    expect((await app.request(new Request("http://tally.test/api/insights"))).status).toBe(401);
  });
});

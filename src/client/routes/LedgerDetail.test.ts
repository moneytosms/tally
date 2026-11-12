// Sort is client-side over already-fetched expenses. paidAt and total both
// need dedicated orderings - swapping the comparator sign is an easy mistake.
import { describe, expect, it } from "vitest";
import { encodeExpenseParams, parseExpenseParams, sortExpenses } from "./LedgerDetail";
import type { Expense } from "~/client/lib/queries";

const mk = (id: string, paidAt: number, total: number): Expense => ({
  id,
  ledgerId: "L1",
  description: id,
  total,
  paidAt,
  payerMemberId: "m_ada",
  categoryId: null,
  notes: null,
  mode: "equal",
  splits: [],
});

const expenses = [
  mk("mid", 2_000, 500_00), // ₹500
  mk("oldest", 1_000, 100_00), // ₹100
  mk("newest", 3_000, 900_00), // ₹900
];

describe("sortExpenses", () => {
  it("orders newest first by paidAt descending", () => {
    expect(sortExpenses(expenses, "newest").map((e) => e.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("orders oldest first by paidAt ascending", () => {
    expect(sortExpenses(expenses, "oldest").map((e) => e.id)).toEqual(["oldest", "mid", "newest"]);
  });

  it("orders by amount high to low", () => {
    expect(sortExpenses(expenses, "amountHigh").map((e) => e.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("orders by amount low to high", () => {
    expect(sortExpenses(expenses, "amountLow").map((e) => e.id)).toEqual(["oldest", "mid", "newest"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...expenses];
    sortExpenses(expenses, "oldest");
    expect(expenses).toEqual(copy);
  });

  it("sorts negative totals (refunds) correctly by amount", () => {
    const withRefund = [...expenses, mk("refund", 4_000, -50_00)];
    expect(sortExpenses(withRefund, "amountLow").map((e) => e.id)).toEqual(["refund", "oldest", "mid", "newest"]);
  });
});

describe("expense query in the URL", () => {
  // Local-midnight timestamps, so the day round trip does not depend on the machine's zone.
  const oct22 = new Date("2026-10-22T00:00:00").getTime();
  const oct30End = new Date("2026-10-30T23:59:59.999").getTime();

  it("round trips every filter and a non-default sort", () => {
    const query = {
      q: "coffee",
      categoryId: "cat_food",
      memberId: "m_ada",
      from: oct22,
      to: oct30End,
      sort: "amountHigh" as const,
    };
    const params = encodeExpenseParams(query);
    expect(params.get("from")).toBe("2026-10-22");
    expect(params.get("to")).toBe("2026-10-30");
    expect(parseExpenseParams(params)).toEqual(query);
  });

  it("omits defaults so the default view has a clean URL", () => {
    expect(encodeExpenseParams({ sort: "newest" }).toString()).toBe("");
  });

  it("ignores unknown params and unknown sort values", () => {
    const parsed = parseExpenseParams(new URLSearchParams("sort=toString&page=3&q="));
    expect(parsed).toEqual({
      sort: "newest",
      q: undefined,
      categoryId: undefined,
      memberId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("ignores invalid dates, including impossible ones", () => {
    const parsed = parseExpenseParams(new URLSearchParams("from=22-10-2026&to=2026-02-31"));
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });
});

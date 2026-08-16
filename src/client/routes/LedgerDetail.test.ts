// Sort is client-side over already-fetched expenses. paidAt and total both
// need dedicated orderings - swapping the comparator sign is an easy mistake.
import { describe, expect, it } from "vitest";
import { sortExpenses } from "./LedgerDetail";
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

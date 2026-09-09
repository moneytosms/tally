// Pure logic behind the "why?" disclosure. The trail itself is built on the
// server (trailFor in src/server/routes/balances.ts) because only the server can
// see settlements; what is left here is the question the UI actually asks of it:
// does this list account for the whole payment, or does the disclaimer belong?
//
// Amounts are paise, written as integers with the rupee value in a comment.
import { describe, expect, it } from "vitest";
import { fullyExplained, trailNet } from "./WhyTrail";
import type { TrailRow } from "~/client/lib/queries";

const expense = (amount: number, at = 1): TrailRow => ({
  kind: "expense",
  id: `e-${at}-${amount}`,
  expenseId: `e-${at}-${amount}`,
  description: "x",
  at,
  amount,
});

const settlement = (amount: number, at = 1): TrailRow => ({
  kind: "settlement",
  id: `s-${at}-${amount}`,
  expenseId: null,
  description: "",
  at,
  amount,
});

describe("trailNet", () => {
  it("adds the rows signed: what `to` paid, less what `from` paid", () => {
    // `to` paid and `from` took a ₹200.00 share; `from` paid and `to` took ₹150.00
    expect(trailNet([expense(200_00), expense(-150_00, 2)])).toBe(50_00);
  });

  it("counts a settlement already made against the obligation", () => {
    // ₹200.00 owed, ₹80.00 of it already settled by `from`
    expect(trailNet([expense(200_00), settlement(-80_00, 2)])).toBe(120_00);
  });

  it("is zero for an empty trail", () => {
    expect(trailNet([])).toBe(0);
  });
});

describe("fullyExplained", () => {
  it("is true when the rows account for the whole suggested amount", () => {
    expect(fullyExplained([expense(200_00), expense(-150_00, 2)], 50_00)).toBe(true);
  });

  it("stays true once a partial settle is in the trail", () => {
    // The pre-fix trail listed the ₹200.00 expense alone against a ₹120.00
    // suggestion and disclaimed a transfer it could explain exactly.
    expect(fullyExplained([expense(200_00), settlement(-80_00, 2)], 120_00)).toBe(true);
  });

  it("is false when simplification put money in the transfer that these rows don't hold", () => {
    expect(fullyExplained([expense(200_00)], 300_00)).toBe(false);
  });

  it("is false for an empty trail - there is nothing to be explained by", () => {
    expect(fullyExplained([], 0)).toBe(false);
  });
});

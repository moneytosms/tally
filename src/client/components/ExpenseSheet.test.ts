// A restore rewrites money, so the row that offers it must say what it would
// change. That claim is this diff, and nothing else in the sheet computes it.
import { describe, expect, it } from "vitest";
import { revisionDiff } from "./ExpenseSheet";

const current = {
  total: 120000, // ₹1,200.00
  payerMemberId: "a",
  splits: [
    { memberId: "a", amount: 60000 }, // ₹600.00
    { memberId: "b", amount: 60000 }, // ₹600.00
  ],
};

describe("revisionDiff", () => {
  it("reports nothing when the snapshot is the expense as it stands", () => {
    expect(revisionDiff({ ...current }, current)).toEqual([]);
  });

  it("ignores the order splits are listed in - stable order matters to rounding, not to sameness", () => {
    const reordered = { ...current, splits: [...current.splits].reverse() };
    expect(revisionDiff(reordered, current)).toEqual([]);
  });

  it("reports a changed total", () => {
    const snapshot = {
      ...current,
      total: 100000, // ₹1,000.00
      splits: [
        { memberId: "a", amount: 50000 }, // ₹500.00
        { memberId: "b", amount: 50000 }, // ₹500.00
      ],
    };
    expect(revisionDiff(snapshot, current)).toEqual(["total", "splits"]);
  });

  it("reports a changed payer on its own - the payer is not a participant here", () => {
    expect(revisionDiff({ ...current, payerMemberId: "c" }, current)).toEqual(["payer"]);
  });

  it("reports a changed split at an unchanged total", () => {
    const snapshot = {
      ...current,
      splits: [
        { memberId: "a", amount: 80000 }, // ₹800.00
        { memberId: "b", amount: 40000 }, // ₹400.00
      ],
    };
    expect(revisionDiff(snapshot, current)).toEqual(["splits"]);
  });

  it("reports a split whose participants changed, not only their amounts", () => {
    const snapshot = {
      ...current,
      splits: [{ memberId: "a", amount: 120000 }], // ₹1,200.00
    };
    expect(revisionDiff(snapshot, current)).toEqual(["splits"]);
  });

  it("does not mutate the splits it is handed", () => {
    const splits = [
      { memberId: "b", amount: 60000 }, // ₹600.00
      { memberId: "a", amount: 60000 }, // ₹600.00
    ];
    revisionDiff({ ...current, splits }, current);
    expect(splits[0]!.memberId).toBe("b");
  });
});

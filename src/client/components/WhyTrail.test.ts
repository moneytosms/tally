// Pure logic behind the "why?" disclosure. See WhyTrail.tsx for why
// fullyExplained matters: a simplified transfer can have a direct trail
// that doesn't sum to the transfer amount, and the UI must say so rather
// than imply completeness.
import { describe, expect, it } from "vitest";
import { directTrail, directTrailNet } from "./WhyTrail";

const FROM = "m-from";
const TO = "m-to";

function expense(payerMemberId: string, splits: Array<{ memberId: string; amount: number }>, paidAt = 1) {
  return { id: `e-${paidAt}-${payerMemberId}`, payerMemberId, description: "x", paidAt, splits };
}

describe("directTrail", () => {
  it("to paid, from has a split: one row, net is negative (from owes)", () => {
    const rows = directTrail(
      [expense(TO, [{ memberId: FROM, amount: 200_00 }])],
      FROM,
      TO,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidByTo).toBe(true);
    expect(directTrailNet(rows)).toBe(-200_00);
  });

  it("from paid, to has a split: one row, net is positive (to owes from)", () => {
    const rows = directTrail(
      [expense(FROM, [{ memberId: TO, amount: 150_00 }])],
      FROM,
      TO,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidByTo).toBe(false);
    expect(directTrailNet(rows)).toBe(150_00);
  });

  it("both directions present: net is the correct sum, not just one side", () => {
    const rows = directTrail(
      [
        expense(TO, [{ memberId: FROM, amount: 200_00 }], 1),
        expense(FROM, [{ memberId: TO, amount: 150_00 }], 2),
      ],
      FROM,
      TO,
    );
    expect(rows).toHaveLength(2);
    expect(directTrailNet(rows)).toBe(150_00 - 200_00);
  });

  it("no shared expenses: empty trail, zero net", () => {
    const rows = directTrail(
      [expense("someone-else", [{ memberId: "another", amount: 100_00 }])],
      FROM,
      TO,
    );
    expect(rows).toEqual([]);
    expect(directTrailNet(rows)).toBe(0);
  });

  it("fullyExplained: net exactly matches -amount at the integer paise boundary", () => {
    const rows = directTrail(
      [expense(TO, [{ memberId: FROM, amount: 640_00 }])],
      FROM,
      TO,
    );
    const net = directTrailNet(rows);
    const amount = 640_00;
    const fullyExplained = rows.length > 0 && -net === amount;
    expect(fullyExplained).toBe(true);
  });

  it("simplified/partial: rows exist but net doesn't cover the transfer amount", () => {
    const rows = directTrail(
      [expense(TO, [{ memberId: FROM, amount: 200_00 }])],
      FROM,
      TO,
    );
    const net = directTrailNet(rows);
    const amount = 640_00;
    const fullyExplained = rows.length > 0 && -net === amount;
    expect(fullyExplained).toBe(false);
  });
});

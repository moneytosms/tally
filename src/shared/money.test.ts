import { describe, expect, it } from "vitest";
import { formatPaise, resolveSplits, type SplitMode } from "~/shared/money";
import { createExpenseSchema } from "~/shared/schemas";

// The twelve worked examples from issue #6. Amounts are PAISE.
// `P` marks the payer; participants are in stable order (order of addition).

describe("the twelve worked examples", () => {
  it("1 — equal, clean", () => {
    // 900.00 among A(P), B, C
    expect(resolveSplits({ total: 90000, mode: "equal", participantCount: 3, payerIndex: 0 })).toEqual([
      30000, 30000, 30000,
    ]);
  });

  it("2 — equal, remainder to payer", () => {
    // 100.00 among A(P), B, C -> A absorbs the odd paisa
    expect(resolveSplits({ total: 10000, mode: "equal", participantCount: 3, payerIndex: 0 })).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it("3 — equal, payer not a participant: first in stable order absorbs", () => {
    // 100.00 among A, B, C; payer D is not a participant
    expect(resolveSplits({ total: 10000, mode: "equal", participantCount: 3, payerIndex: -1 })).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it("4 — exact", () => {
    // 1000.00 = A(P) 500.00 + B 300.00 + C 200.00
    expect(
      resolveSplits({
        total: 100000,
        mode: "exact",
        participantCount: 3,
        payerIndex: 0,
        values: [50000, 30000, 20000],
      }),
    ).toEqual([50000, 30000, 20000]);
  });

  it("4 — exact is rejected when the parts do not sum to the total", () => {
    expect(() =>
      resolveSplits({
        total: 100000, // 1000.00
        mode: "exact",
        participantCount: 3,
        payerIndex: 0,
        values: [50000, 30000, 19999],
      }),
    ).toThrow();
  });

  it("5 — shares, exact", () => {
    // 1000.00, weights A(P) 2 : B 1 : C 1
    expect(
      resolveSplits({ total: 100000, mode: "shares", participantCount: 3, payerIndex: 0, values: [2, 1, 1] }),
    ).toEqual([50000, 25000, 25000]);
  });

  it("6 — shares with remainder", () => {
    // 100.00, weights 2:1:1 divides cleanly
    expect(
      resolveSplits({ total: 10000, mode: "shares", participantCount: 3, payerIndex: 0, values: [2, 1, 1] }),
    ).toEqual([5000, 2500, 2500]);
    // 100.01 -> the odd paisa lands on the payer
    expect(
      resolveSplits({ total: 10001, mode: "shares", participantCount: 3, payerIndex: 0, values: [2, 1, 1] }),
    ).toEqual([5001, 2500, 2500]);
  });

  it("7 — percent", () => {
    // 1000.00, A(P) 60% / B 40%
    expect(
      resolveSplits({ total: 100000, mode: "percent", participantCount: 2, payerIndex: 0, values: [60, 40] }),
    ).toEqual([60000, 40000]);
  });

  it("7 — percent is rejected when percents do not sum to 100", () => {
    expect(() =>
      resolveSplits({ total: 100000, mode: "percent", participantCount: 2, payerIndex: 0, values: [60, 30] }),
    ).toThrow();
  });

  it("8 — percent with remainder", () => {
    // 100.00, 33% / 33% / 34%
    expect(
      resolveSplits({ total: 10000, mode: "percent", participantCount: 3, payerIndex: 0, values: [33, 33, 34] }),
    ).toEqual([3300, 3300, 3400]);
  });

  it("9 — guest participant is just another member id", () => {
    // 300.00 among A(P), B, G
    expect(resolveSplits({ total: 30000, mode: "equal", participantCount: 3, payerIndex: 0 })).toEqual([
      10000, 10000, 10000,
    ]);
  });

  it("10 — guest payer", () => {
    // 300.00 among A, B, G(P) — G is participant index 2
    expect(resolveSplits({ total: 30000, mode: "equal", participantCount: 3, payerIndex: 2 })).toEqual([
      10000, 10000, 10000,
    ]);
  });

  it("11 — refund", () => {
    // -50.00 between A(P) and B
    expect(resolveSplits({ total: -5000, mode: "equal", participantCount: 2, payerIndex: 0 })).toEqual([
      -2500, -2500,
    ]);
  });

  it("12 — refund with remainder: truncation toward zero, payer takes the larger magnitude", () => {
    // -100.00 among A(P), B, C
    const parts = resolveSplits({ total: -10000, mode: "equal", participantCount: 3, payerIndex: 0 });
    expect(parts).toEqual([-3334, -3333, -3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-10000);
  });
});

describe("rejections", () => {
  it("rejects an empty participant list", () => {
    expect(() => resolveSplits({ total: 10000, mode: "equal", participantCount: 0, payerIndex: -1 })).toThrow();
  });

  it("rejects a zero total", () => {
    expect(() => resolveSplits({ total: 0, mode: "equal", participantCount: 2, payerIndex: 0 })).toThrow();
  });

  it("rejects a non-integer total", () => {
    expect(() => resolveSplits({ total: 100.5, mode: "equal", participantCount: 2, payerIndex: 0 })).toThrow();
    expect(() => resolveSplits({ total: NaN, mode: "equal", participantCount: 2, payerIndex: 0 })).toThrow();
  });

  it("rejects absurd magnitudes", () => {
    expect(() => resolveSplits({ total: 1e13 + 1, mode: "equal", participantCount: 2, payerIndex: 0 })).toThrow();
    expect(() => resolveSplits({ total: -(1e13 + 1), mode: "equal", participantCount: 2, payerIndex: 0 })).toThrow();
  });

  it("rejects a zero or negative shares weight", () => {
    expect(() =>
      resolveSplits({ total: 10000, mode: "shares", participantCount: 3, payerIndex: 0, values: [2, 0, 1] }),
    ).toThrow();
    expect(() =>
      resolveSplits({ total: 10000, mode: "shares", participantCount: 3, payerIndex: 0, values: [2, -1, 1] }),
    ).toThrow();
  });

  it("rejects a zero or negative percent", () => {
    expect(() =>
      resolveSplits({ total: 10000, mode: "percent", participantCount: 3, payerIndex: 0, values: [100, 0, 0] }),
    ).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() =>
      resolveSplits({ total: 10000, mode: "shares", participantCount: 2, payerIndex: 0, values: [1.5, 1] }),
    ).toThrow();
    expect(() =>
      resolveSplits({ total: 10000, mode: "percent", participantCount: 2, payerIndex: 0, values: [33.5, 66.5] }),
    ).toThrow();
  });

  it("rejects a values length that does not match the participant count", () => {
    expect(() =>
      resolveSplits({ total: 10000, mode: "exact", participantCount: 3, payerIndex: 0, values: [10000] }),
    ).toThrow();
    expect(() =>
      resolveSplits({ total: 10000, mode: "shares", participantCount: 3, payerIndex: 0 }),
    ).toThrow();
  });

  it("rejects a payerIndex outside the participant list", () => {
    expect(() => resolveSplits({ total: 10000, mode: "equal", participantCount: 2, payerIndex: 2 })).toThrow();
    expect(() => resolveSplits({ total: 10000, mode: "equal", participantCount: 2, payerIndex: -2 })).toThrow();
  });
});

describe("invariant: splits always sum exactly to the total", () => {
  // Integer percents that sum to 100 for n participants (n <= 100, no zero shares).
  const percents = (n: number): number[] => {
    const base = Math.floor(100 / n);
    const out = Array<number>(n).fill(base);
    out[n - 1] = 100 - base * (n - 1);
    return out;
  };
  const weights = (n: number): number[] => Array.from({ length: n }, (_, i) => (i % 5) + 1);

  const totals: number[] = [];
  for (let t = 1; t <= 47; t++) totals.push(t, -t);
  for (const t of [999999, 1000001, 123456789, 1e13, 7, 10000, 33333]) totals.push(t, -t);

  it("holds for every mode, total and participant count", () => {
    let checked = 0;
    const bad: string[] = [];
    for (const total of totals) {
      for (let n = 1; n <= 9; n++) {
        for (let payerIndex = -1; payerIndex < n; payerIndex++) {
          const cases: Array<{ mode: SplitMode; values?: number[] }> = [
            { mode: "equal" },
            { mode: "shares", values: weights(n) },
            { mode: "percent", values: percents(n) },
          ];
          for (const { mode, values } of cases) {
            const parts = resolveSplits({ total, mode, participantCount: n, payerIndex, values });
            const sum = parts.reduce((a, b) => a + b, 0);
            if (parts.length !== n || sum !== total || !parts.every(Number.isInteger)) {
              bad.push(`${mode} total=${total} n=${n} payer=${payerIndex} -> ${parts.join(",")}`);
            }
            checked++;
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(10000);
  });

  it("gives the remainder to the payer, else to the first participant", () => {
    // 100.00 among 3, payer at index 1
    expect(resolveSplits({ total: 10000, mode: "equal", participantCount: 3, payerIndex: 1 })).toEqual([
      3333, 3334, 3333,
    ]);
  });
});

describe("createExpenseSchema", () => {
  const base = {
    description: "Dinner",
    total: 10000, // 100.00
    paidAtEpochMs: 1786000000000,
    payerMemberId: "m1",
    mode: "equal" as const,
    participants: [{ memberId: "m1" }, { memberId: "m2" }],
  };

  it("accepts a well-formed expense", () => {
    expect(createExpenseSchema.parse(base).total).toBe(10000);
  });

  it("rejects a zero total, a non-integer total and an empty participant list", () => {
    expect(createExpenseSchema.safeParse({ ...base, total: 0 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, total: 100.5 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, participants: [] }).success).toBe(false);
  });

  it("accepts a negative total (a refund)", () => {
    expect(createExpenseSchema.safeParse({ ...base, total: -5000 }).success).toBe(true); // -50.00
  });
});

describe("formatPaise", () => {
  it("always shows two decimals and the rupee sign", () => {
    expect(formatPaise(0)).toBe("₹0.00");
    expect(formatPaise(10000)).toBe("₹100.00");
    expect(formatPaise(3334)).toBe("₹33.34");
    expect(formatPaise(-3334)).toBe("-₹33.34");
    expect(formatPaise(5)).toBe("₹0.05");
  });

  it("groups in the Indian system", () => {
    expect(formatPaise(1000000000)).toBe("₹1,00,00,000.00"); // 1 crore
  });
});

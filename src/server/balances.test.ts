// Amounts are paise. Rupee value in a comment beside each.
import { describe, expect, it } from "vitest";
import { memberBreakdown, netPositions, transferPlan, type NetPosition } from "~/server/balances";

type Expense = Parameters<typeof netPositions>[0][number];
type Settlement = Parameters<typeof netPositions>[1][number];
type Breakdown = { memberId: string; paid: number; share: number; settledOut: number; settledIn: number };

const net = (ps: NetPosition[], id: string) => ps.find((p) => p.memberId === id)?.net;
const sum = (ps: NetPosition[]) => ps.reduce((a, p) => a + p.net, 0);

describe("netPositions", () => {
  it("one expense: the payer is owed the total minus their own share", () => {
    // ₹100 paid by A, split equally A/B
    const e: Expense = {
      payerMemberId: "A",
      splits: [
        { memberId: "A", amount: 5000 }, // ₹50
        { memberId: "B", amount: 5000 }, // ₹50
      ],
    };
    const ps = netPositions([e], []);
    expect(net(ps, "A")).toBe(5000); // ₹50 owed to A
    expect(net(ps, "B")).toBe(-5000); // ₹50 owed by B
    expect(sum(ps)).toBe(0);
  });

  it("a payer who is not a participant is owed the whole total", () => {
    // ₹90 paid by C, split equally A/B - C is not a participant
    const ps = netPositions(
      [
        {
          payerMemberId: "C",
          splits: [
            { memberId: "A", amount: 4500 }, // ₹45
            { memberId: "B", amount: 4500 }, // ₹45
          ],
        },
      ],
      [],
    );
    expect(net(ps, "C")).toBe(9000); // ₹90
    expect(net(ps, "A")).toBe(-4500);
    expect(net(ps, "B")).toBe(-4500);
    expect(sum(ps)).toBe(0);
  });

  it("a refund (negative total, negative splits) moves positions back toward zero", () => {
    // ₹100 paid by A split A/B, then a ₹40 refund received by A split A/B
    const expense: Expense = {
      payerMemberId: "A",
      splits: [
        { memberId: "A", amount: 5000 }, // ₹50
        { memberId: "B", amount: 5000 }, // ₹50
      ],
    };
    const refund: Expense = {
      payerMemberId: "A",
      splits: [
        { memberId: "A", amount: -2000 }, // -₹20
        { memberId: "B", amount: -2000 }, // -₹20
      ],
    };
    const before = netPositions([expense], []);
    const after = netPositions([expense, refund], []);
    expect(net(before, "B")).toBe(-5000); // ₹50 owed
    expect(net(after, "B")).toBe(-3000); // ₹30 owed - closer to zero
    expect(net(after, "A")).toBe(3000);
    expect(sum(after)).toBe(0);
  });

  it("a settlement for the exact owed amount zeroes both parties", () => {
    const expense: Expense = {
      payerMemberId: "A",
      splits: [
        { memberId: "A", amount: 5000 }, // ₹50
        { memberId: "B", amount: 5000 }, // ₹50
      ],
    };
    const s: Settlement = { fromMemberId: "B", toMemberId: "A", amount: 5000 }; // ₹50
    const ps = netPositions([expense], [s]);
    expect(net(ps, "A")).toBe(0);
    expect(net(ps, "B")).toBe(0);
  });

  it("settlement direction is signed correctly in both directions", () => {
    // No expenses: a bare settlement of ₹10 from B to A leaves B owed ₹10.
    const ba = netPositions([], [{ fromMemberId: "B", toMemberId: "A", amount: 1000 }]);
    expect(net(ba, "B")).toBe(1000); // ₹10 - B overpaid, is now owed it
    expect(net(ba, "A")).toBe(-1000);

    const ab = netPositions([], [{ fromMemberId: "A", toMemberId: "B", amount: 1000 }]);
    expect(net(ab, "A")).toBe(1000);
    expect(net(ab, "B")).toBe(-1000);
  });

  it("a partial settlement leaves exactly the remainder (SPEC §6: ₹500 against ₹640)", () => {
    const expense: Expense = {
      payerMemberId: "A",
      splits: [
        { memberId: "A", amount: 0 },
        { memberId: "B", amount: 64000 }, // ₹640
      ],
    };
    const ps = netPositions(
      [expense],
      [
        { fromMemberId: "B", toMemberId: "A", amount: 50000 }, // ₹500
      ],
    );
    expect(net(ps, "B")).toBe(-14000); // ₹140 remains
    expect(net(ps, "A")).toBe(14000);
  });

  it("a forgiven settlement is arithmetically ordinary", () => {
    // method is not part of the input at all - the engine cannot special-case it.
    const ps = netPositions(
      [{ payerMemberId: "A", splits: [{ memberId: "B", amount: 2500 }] }], // ₹25
      [{ fromMemberId: "B", toMemberId: "A", amount: 2500 }],
    );
    expect(sum(ps)).toBe(0);
    expect(ps.every((p) => p.net === 0)).toBe(true);
  });

  it("returns a member whose net position is zero", () => {
    // A pays ₹20 for B; B pays ₹20 for A. Both net zero, both still listed.
    const ps = netPositions(
      [
        { payerMemberId: "A", splits: [{ memberId: "B", amount: 2000 }] }, // ₹20
        { payerMemberId: "B", splits: [{ memberId: "A", amount: 2000 }] }, // ₹20
      ],
      [],
    );
    expect(ps.map((p) => p.memberId).sort()).toEqual(["A", "B"]);
    expect(ps.every((p) => p.net === 0)).toBe(true);
    expect(transferPlan(ps)).toEqual([]);
  });

  it("all amounts stay integers", () => {
    // ₹100.01 paid by A across three participants - resolved splits, not divided here
    const ps = netPositions(
      [
        {
          payerMemberId: "A",
          splits: [
            { memberId: "A", amount: 3335 },
            { memberId: "B", amount: 3333 },
            { memberId: "C", amount: 3333 },
          ],
        },
      ],
      [],
    );
    expect(ps.every((p) => Number.isInteger(p.net))).toBe(true);
  });
});

// --- generated scenarios ---------------------------------------------------
// Deterministic integer LCG: reproducible failures, no float in any amount.
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

function scenario(seed: number) {
  const r = rng(seed);
  const members = Array.from({ length: 2 + r(6) }, (_, i) => `m${i}`);
  const pick = () => members[r(members.length)]!;

  const expenses: Array<Expense & { total: number }> = [];
  for (let i = 0; i <= r(8); i++) {
    const participants = members.filter(() => r(2) === 0);
    if (participants.length === 0) participants.push(pick());
    const sign = r(5) === 0 ? -1 : 1; // one in five is a refund
    const splits = participants.map((memberId) => ({
      memberId,
      amount: sign * (1 + r(500000)), // up to ₹5000 per participant
    }));
    // Splits sum to total, as write-time validation guarantees.
    expenses.push({ payerMemberId: pick(), total: splits.reduce((a, x) => a + x.amount, 0), splits });
  }

  const settlements: Settlement[] = [];
  for (let i = 0; i < r(4); i++) {
    const from = pick();
    const to = pick();
    if (from !== to) settlements.push({ fromMemberId: from, toMemberId: to, amount: 1 + r(200000) });
  }
  return { expenses, settlements };
}

const seeds = Array.from({ length: 300 }, (_, i) => i + 1);

describe("invariants over generated scenarios", () => {
  it("net positions sum to exactly zero", () => {
    for (const seed of seeds) {
      const { expenses, settlements } = scenario(seed);
      expect(sum(netPositions(expenses, settlements)), `seed ${seed}`).toBe(0);
    }
  });

  it("the transfer plan, applied as settlements, drives every net position to zero", () => {
    for (const seed of seeds) {
      const { expenses, settlements } = scenario(seed);
      const positions = netPositions(expenses, settlements);
      const plan = transferPlan(positions);
      const after = netPositions(expenses, [...settlements, ...plan]);
      expect(
        after.every((p) => p.net === 0),
        `seed ${seed}: ${JSON.stringify(after)}`,
      ).toBe(true);
    }
  });

  it("the transfer plan emits no non-positive amount and no self-transfer", () => {
    for (const seed of seeds) {
      const { expenses, settlements } = scenario(seed);
      const plan = transferPlan(netPositions(expenses, settlements));
      for (const t of plan) {
        expect(t.amount, `seed ${seed}`).toBeGreaterThan(0);
        expect(Number.isInteger(t.amount)).toBe(true);
        expect(t.fromMemberId).not.toBe(t.toMemberId);
      }
    }
  });

  it("the transfer plan uses at most n-1 transfers", () => {
    for (const seed of seeds) {
      const { expenses, settlements } = scenario(seed);
      const positions = netPositions(expenses, settlements);
      const plan = transferPlan(positions);
      if (positions.length > 0) expect(plan.length, `seed ${seed}`).toBeLessThanOrEqual(positions.length - 1);
    }
  });
});

describe("memberBreakdown", () => {
  const byId = (bs: Breakdown[], id: string) => bs.find((b) => b.memberId === id);

  it("the identity paid - share + settledOut - settledIn === net holds for every member, every seed", () => {
    for (const seed of seeds) {
      const { expenses, settlements } = scenario(seed);
      const ps = netPositions(expenses, settlements);
      const bs = memberBreakdown(expenses, settlements);
      expect(bs.map((b) => b.memberId).sort(), `seed ${seed}`).toEqual(ps.map((p) => p.memberId).sort());
      for (const p of ps) {
        const b = byId(bs, p.memberId)!;
        expect(b.paid - b.share + b.settledOut - b.settledIn, `seed ${seed} ${p.memberId}`).toBe(p.net);
        expect(Number.isInteger(b.paid + b.share + b.settledOut + b.settledIn), `seed ${seed}`).toBe(true);
      }
    }
  });

  it("a refund (negative total) reduces both paid and share", () => {
    // ₹100 paid by A split A/B, then a ₹40 refund paid by A split A/B
    const bs = memberBreakdown(
      [
        {
          payerMemberId: "A",
          total: 10_000, // ₹100
          splits: [
            { memberId: "A", amount: 5_000 }, // ₹50
            { memberId: "B", amount: 5_000 }, // ₹50
          ],
        },
        {
          payerMemberId: "A",
          total: -4_000, // -₹40
          splits: [
            { memberId: "A", amount: -2_000 }, // -₹20
            { memberId: "B", amount: -2_000 }, // -₹20
          ],
        },
      ],
      [],
    );
    expect(byId(bs, "A")).toEqual({ memberId: "A", paid: 6_000, share: 3_000, settledOut: 0, settledIn: 0 }); // ₹60 paid, ₹30 share
    expect(byId(bs, "B")).toEqual({ memberId: "B", paid: 0, share: 3_000, settledOut: 0, settledIn: 0 }); // ₹30 share
  });

  it("a partial settlement shows on the settler's out and the receiver's in, not on paid or share", () => {
    // ₹640 paid by A, all for B; B settles ₹500 of it
    const bs = memberBreakdown(
      [{ payerMemberId: "A", total: 64_000, splits: [{ memberId: "B", amount: 64_000 }] }], // ₹640
      [{ fromMemberId: "B", toMemberId: "A", amount: 50_000 }], // ₹500
    );
    expect(byId(bs, "B")).toEqual({ memberId: "B", paid: 0, share: 64_000, settledOut: 50_000, settledIn: 0 });
    expect(byId(bs, "A")).toEqual({ memberId: "A", paid: 64_000, share: 0, settledOut: 0, settledIn: 50_000 });
  });

  it("a member who appears only in a settlement still gets an entry", () => {
    // C pays A ₹10 with no expenses at all
    const bs = memberBreakdown([], [{ fromMemberId: "C", toMemberId: "A", amount: 1_000 }]); // ₹10
    expect(bs).toHaveLength(2);
    expect(byId(bs, "C")).toEqual({ memberId: "C", paid: 0, share: 0, settledOut: 1_000, settledIn: 0 });
    expect(byId(bs, "A")).toEqual({ memberId: "A", paid: 0, share: 0, settledOut: 0, settledIn: 1_000 });
  });
});

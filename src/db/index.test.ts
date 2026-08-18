// mergeGuestIntoMember, over the real data-access layer (issue #36). Seed (see
// _test-harness): L1 holds Ada (m_ada), Bob (m_bob) and the guest Dee (m_guest).
// Amounts in paise, rupee value noted in comments.
import { beforeEach, describe, expect, it } from "vitest";
import { netPositions } from "~/server/balances";
import { type Harness, setup } from "~/server/routes/_test-harness";
import { uuidv7 } from "~/shared/id";

let h: Harness;

beforeEach(async () => {
  h = await setup();
});

/** E1: guest Dee PAYS, split evenly with Ada - Bob is not a participant here,
 *  so reassigning Dee -> Bob hits no existing split row on this expense.
 *  E2: Ada pays, Dee and Bob both PARTICIPATE - Bob already holds a split row
 *  here, so merging Dee's ₹3.00 onto Bob's existing ₹7.00 must sum rather than
 *  collide with expense_splits' unique (expense_id, member_id) index. */
async function seedExpenses() {
  const e1 = uuidv7();
  await h.db.insertExpense({
    id: e1,
    ledgerId: "L1",
    description: "Snacks",
    total: 1_000, // ₹10.00
    paidAt: Date.now(),
    payerMemberId: "m_guest",
    mode: "equal",
    createdBy: "u_ada",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await h.db.insertSplits([
    { id: uuidv7(), expenseId: e1, memberId: "m_guest", amount: 500, sortOrder: 0 }, // ₹5.00
    { id: uuidv7(), expenseId: e1, memberId: "m_ada", amount: 500, sortOrder: 1 }, // ₹5.00
  ]);

  const e2 = uuidv7();
  await h.db.insertExpense({
    id: e2,
    ledgerId: "L1",
    description: "Cab",
    total: 1_000, // ₹10.00
    paidAt: Date.now(),
    payerMemberId: "m_ada",
    mode: "exact",
    createdBy: "u_ada",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await h.db.insertSplits([
    { id: uuidv7(), expenseId: e2, memberId: "m_guest", amount: 300, sortOrder: 0 }, // ₹3.00
    { id: uuidv7(), expenseId: e2, memberId: "m_bob", amount: 700, sortOrder: 1 }, // ₹7.00
  ]);

  return { e1, e2 };
}

describe("mergeGuestIntoMember", () => {
  it("reassigns payer + participant references, sums a split that collides with the target, soft-deletes the guest, and preserves net positions", async () => {
    const { e1, e2 } = await seedExpenses();

    const before = netPositions(await h.db.listExpenses("L1"), await h.db.listSettlements("L1"));
    const guestNetBefore = before.find((p) => p.memberId === "m_guest")?.net ?? 0;
    const bobNetBefore = before.find((p) => p.memberId === "m_bob")?.net ?? 0;

    await h.db.mergeGuestIntoMember("L1", "m_guest", "m_bob", "u_ada");

    // Guest row is soft-deleted - gone from the live roster.
    const members = await h.db.listMembers("L1");
    expect(members.some((m) => m.id === "m_guest")).toBe(false);

    const expenses = await h.db.listExpenses("L1");
    const gotE1 = expenses.find((e) => e.id === e1)!;
    const gotE2 = expenses.find((e) => e.id === e2)!;

    // E1: payer reassigned, guest's split moved onto Bob (no prior Bob split here).
    expect(gotE1.payerMemberId).toBe("m_bob");
    expect(gotE1.splits.map((s) => [s.memberId, s.amount]).sort()).toEqual(
      [
        ["m_ada", 500],
        ["m_bob", 500],
      ].sort(),
    );

    // E2: Bob already participated - his split absorbs the guest's amount
    // instead of a second row for the same (expense, member).
    expect(gotE2.payerMemberId).toBe("m_ada");
    expect(gotE2.splits).toHaveLength(1);
    expect(gotE2.splits[0]).toMatchObject({ memberId: "m_bob", amount: 1_000 });

    // No reference to the guest survives anywhere live.
    expect(expenses.every((e) => e.payerMemberId !== "m_guest")).toBe(true);
    expect(expenses.every((e) => e.splits.every((s) => s.memberId !== "m_guest"))).toBe(true);

    // Each touched expense is undoable/auditable like any other edit.
    expect(await h.db.listRevisions(e1)).toHaveLength(1);
    expect(await h.db.listRevisions(e2)).toHaveLength(1);
    const [rev1] = await h.db.listRevisions(e1);
    expect(rev1!.revisedBy).toBe("u_ada");

    // ADR 0004: the guest's net position lands on the target's, and the ledger
    // still sums to zero.
    const after = netPositions(await h.db.listExpenses("L1"), await h.db.listSettlements("L1"));
    const bobNetAfter = after.find((p) => p.memberId === "m_bob")?.net ?? 0;
    expect(bobNetAfter).toBe(guestNetBefore + bobNetBefore);
    expect(after.some((p) => p.memberId === "m_guest")).toBe(false);
    expect(after.reduce((sum, p) => sum + p.net, 0)).toBe(0);
  });
});

// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import balancesRouter from "~/server/routes/balances";
import expensesRouter from "~/server/routes/expenses";
import settlementsRouter from "~/server/routes/settlements";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expensesRouter, settlementsRouter, balancesRouter);
});

type Ledger = {
  positions: Array<{ memberId: string; net: number }>;
  transfers: Array<{
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    trail: Array<{ expenseId: string; description: string; amount: number }>;
  }>;
  pairs: Array<{ fromMemberId: string; toMemberId: string; amount: number }>;
};

const expense = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: { description: "x", paidAtEpochMs: 1_760_000_000_000, categoryId: null, notes: null, mode: "equal", ...body },
    }),
  );

const ledgerBalances = async (ledgerId: string) =>
  (await (await app.request(req(h, `/api/ledgers/${ledgerId}/balances`))).json()) as Ledger;

const net = (b: Ledger) => new Map(b.positions.map((p) => [p.memberId, p.net]));

describe("GET /ledgers/:ledgerId/balances", () => {
  it("derives net positions and a transfer plan that clears them", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00
    await expense("L1", { total: 4_000, payerMemberId: "m_guest", participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }] }); // ₹40.00

    const b = await ledgerBalances("L1");
    expect(net(b).get("m_ada")).toBe(-7_000);
    expect(net(b).get("m_bob")).toBe(5_000);
    expect(net(b).get("m_guest")).toBe(2_000);
    expect(b.positions.reduce((a, p) => a + p.net, 0)).toBe(0);

    // applying the plan zeroes every position
    const after = new Map(net(b));
    for (const t of b.transfers) {
      after.set(t.fromMemberId, after.get(t.fromMemberId)! + t.amount);
      after.set(t.toMemberId, after.get(t.toMemberId)! - t.amount);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it("returns the expense trail behind each suggested transfer", async () => {
    const dinner = (await (
      await expense("L1", { description: "Dinner", total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹100.00
    ).json()) as { id: string };
    const taxi = (await (
      await expense("L1", { description: "Taxi", total: 3_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹30.00
    ).json()) as { id: string };

    const b = await ledgerBalances("L1");
    expect(b.transfers).toHaveLength(1);
    const [t] = b.transfers;
    expect(t!.amount).toBe(6_500); // ₹50.00 + ₹15.00
    expect(t!.trail.map((x) => [x.expenseId, x.description, x.amount]).sort()).toEqual(
      [
        [dinner.id, "Dinner", 5_000],
        [taxi.id, "Taxi", 1_500],
      ].sort(),
    );
    expect(t!.trail.reduce((a, x) => a + x.amount, 0)).toBe(t!.amount);
  });

  it("explains a simplified transfer through the gross pairs", async () => {
    // Bob owes Ada, the guest owes Bob - the plan suggests guest -> Ada, a pair
    // with no shared expense. `pairs` is what makes that one explainable.
    await expense("L1", { total: 6_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹60.00
    await expense("L1", { total: 6_000, payerMemberId: "m_bob", participants: [{ memberId: "m_bob" }, { memberId: "m_guest" }] }); // ₹60.00

    const b = await ledgerBalances("L1");
    expect(b.transfers).toEqual([
      expect.objectContaining({ fromMemberId: "m_guest", toMemberId: "m_ada", amount: 3_000, trail: [] }),
    ]);
    expect(b.pairs.map((p) => [p.fromMemberId, p.toMemberId, p.amount]).sort()).toEqual(
      [
        ["m_bob", "m_ada", 3_000],
        ["m_guest", "m_bob", 3_000],
      ].sort(),
    );
  });

  it("stops counting a soft-deleted expense", async () => {
    const { id } = (await (
      await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹100.00
    ).json()) as { id: string };
    await expense("L1", { total: 2_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹20.00
    expect(net(await ledgerBalances("L1")).get("m_ada")).toBe(-6_000);

    await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));

    const b = await ledgerBalances("L1");
    expect(net(b).get("m_ada")).toBe(-1_000); // only the ₹20.00 remains
    expect(b.positions.reduce((a, p) => a + p.net, 0)).toBe(0);
    expect(b.transfers[0]!.trail).toHaveLength(1);
  });

  it("counts settlements as well as expenses", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00
    await app.request(
      req(h, "/api/ledgers/L1/settlements", {
        method: "POST",
        json: { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 2_000, method: "manual", note: null }, // ₹20.00
      }),
    );
    expect(net(await ledgerBalances("L1")).get("m_ada")).toBe(-3_000);
  });

  it("403s a non-member", async () => {
    expect((await app.request(req(h, "/api/ledgers/L_nope/balances"))).status).toBe(403);
  });
});

describe("GET /balances", () => {
  type Cross = Array<{ userId: string; displayName: string; vpa: string | null; net: number }>;
  const cross = async () => (await (await app.request(req(h, "/api/balances"))).json()) as Cross;

  it("sums one number per friend across every shared ledger", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00 - Bob +₹50.00
    await expense("L2", { total: 6_000, payerMemberId: "n_cy", participants: [{ memberId: "n_ada" }, { memberId: "n_cy" }] }); // ₹60.00 - Cy +₹30.00

    const rows = await cross();
    expect(rows.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: "u_bob", displayName: "Bob", vpa: "bob@bank", net: 5_000 },
      { userId: "u_cy", displayName: "Cy", vpa: null, net: 3_000 },
    ]);
  });

  it("adds a friend's positions from several ledgers into one figure", async () => {
    // Ada and Cy share only L2 here; Bob appears twice would need a second shared
    // ledger, so use two expenses in L2 with opposite signs instead.
    await expense("L2", { total: 6_000, payerMemberId: "n_cy", participants: [{ memberId: "n_ada" }, { memberId: "n_cy" }] }); // ₹60.00
    await expense("L2", { total: 2_000, payerMemberId: "n_ada", participants: [{ memberId: "n_ada" }, { memberId: "n_cy" }] }); // ₹20.00

    expect((await cross()).find((r) => r.userId === "u_cy")!.net).toBe(2_000); // ₹30.00 - ₹10.00
  });

  it("excludes guests - they are per-ledger entities with no user and no VPA", async () => {
    await expense("L1", { total: 4_000, payerMemberId: "m_guest", participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }] }); // ₹40.00
    const rows = await cross();
    expect(rows.map((r) => r.userId)).not.toContain("m_guest");
    expect(rows.every((r) => r.userId.startsWith("u_"))).toBe(true);
  });

  it("excludes the viewer", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00
    expect((await cross()).map((r) => r.userId)).toEqual(["u_bob"]);
  });

  it("401s without a session", async () => {
    expect((await app.request(new Request("http://tally.test/api/balances"))).status).toBe(401);
  });
});

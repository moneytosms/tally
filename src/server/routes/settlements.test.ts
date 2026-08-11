// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import balancesRouter from "~/server/routes/balances";
import expensesRouter from "~/server/routes/expenses";
import settlementsRouter from "~/server/routes/settlements";
import { netPositions } from "~/server/balances";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expensesRouter, settlementsRouter, balancesRouter);
});

const expense = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: { description: "x", paidAtEpochMs: 1_760_000_000_000, categoryId: null, notes: null, mode: "equal", ...body },
    }),
  );

const settle = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/settlements`, {
      method: "POST",
      json: { method: "manual", note: null, ...body },
    }),
  );

async function positions(ledgerId: string) {
  const [expenses, settlements] = await Promise.all([h.db.listExpenses(ledgerId), h.db.listSettlements(ledgerId)]);
  return new Map(netPositions(expenses, settlements).map((p) => [p.memberId, p.net]));
}

/** Bob pays ₹100.00 split equally: Ada owes Bob ₹50.00. */
const adaOwesBob = () =>
  expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] });

describe("POST /ledgers/:ledgerId/settlements", () => {
  it("moves the balance on declaration, with no acknowledgement", async () => {
    await adaOwesBob();
    expect((await positions("L1")).get("m_ada")).toBe(-5_000);

    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 });
    expect(res.status).toBe(201);

    const [row] = await h.db.listSettlements("L1");
    expect(row!.acknowledgedAt).toBeNull();
    expect((await positions("L1")).get("m_ada")).toBe(0);
    expect((await positions("L1")).get("m_bob")).toBe(0);
  });

  it("leaves exactly the remainder after a partial settle", async () => {
    await adaOwesBob();
    // ₹20.00 against a suggested ₹50.00
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 2_000 });
    expect(res.status).toBe(201);

    const net = await positions("L1");
    expect(net.get("m_ada")).toBe(-3_000); // ₹30.00 still owed
    expect(net.get("m_bob")).toBe(3_000);
  });

  it("records `forgiven` as an ordinary settlement, never a silent write-off", async () => {
    await adaOwesBob();
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000, method: "forgiven", note: "on me" });
    expect(res.status).toBe(201);

    const [row] = await h.db.listSettlements("L1");
    expect(row!.method).toBe("forgiven");
    expect(row!.amount).toBe(5_000);
    expect((await positions("L1")).get("m_ada")).toBe(0);
  });

  it("settles a guest like anyone else", async () => {
    await expense("L1", {
      total: 4_000, // ₹40.00
      payerMemberId: "m_guest",
      participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }],
    });
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_guest", amount: 2_000 });
    expect(res.status).toBe(201);
    expect((await positions("L1")).get("m_guest")).toBe(0);
  });

  it("rejects a member from another ledger", async () => {
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "n_cy", amount: 1_000 });
    expect(res.status).toBe(400);
    expect(await h.db.listSettlements("L1")).toHaveLength(0);
  });

  it("rejects a settlement to oneself and a non-positive amount", async () => {
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_ada", amount: 1_000 })).status).toBe(400);
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 0 })).status).toBe(400);
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: -100 })).status).toBe(400);
  });

  it("acknowledgement is a tick, not a gate", async () => {
    await adaOwesBob();
    await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 });
    const [row] = await h.db.listSettlements("L1");

    const before = await positions("L1");
    const res = await app.request(
      req(h, `/api/ledgers/L1/settlements/${row!.id}/acknowledge`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect((await h.db.listSettlements("L1"))[0]!.acknowledgedAt).toBeGreaterThan(0);
    // the money did not move
    expect(await positions("L1")).toEqual(before);
  });
});

describe("net positions sum to zero", () => {
  it("after any sequence of expenses, refunds and settlements", async () => {
    await expense("L1", { total: 10_001, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }] }); // ₹100.01
    await expense("L1", { total: 7_777, payerMemberId: "m_guest", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹77.77
    await expense("L1", { mode: "percent", total: 9_999, payerMemberId: "m_bob", participants: [{ memberId: "m_ada", value: 33 }, { memberId: "m_bob", value: 33 }, { memberId: "m_guest", value: 34 }] }); // ₹99.99
    await expense("L1", { total: -2_500, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // -₹25.00 refund
    await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 1_234 }); // ₹12.34
    await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_guest", amount: 99, method: "forgiven" }); // ₹0.99

    const net = [...(await positions("L1")).values()];
    expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    expect(net.every(Number.isInteger)).toBe(true);
  });
});

describe("POST /settlements/bulk", () => {
  /** Ada owes Bob ₹50.00 and the guest ₹20.00 in L1, and Cy ₹30.00 in L2. */
  async function owingEverywhere() {
    await adaOwesBob();
    await expense("L1", { total: 4_000, payerMemberId: "m_guest", participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }] }); // ₹40.00
    await expense("L2", { total: 6_000, payerMemberId: "n_cy", participants: [{ memberId: "n_ada" }, { memberId: "n_cy" }] }); // ₹60.00
  }

  it("writes into every contributing ledger and skips guests explicitly", async () => {
    await owingEverywhere();
    const res = await app.request(req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      settlements: Array<{ ledgerId: string; toMemberId: string; amount: number }>;
      skipped: Array<{ ledgerId: string; memberId: string; guestName: string | null; amount: number }>;
    };

    expect(body.total).toBe(8_000); // ₹50.00 + ₹30.00
    expect(body.settlements.map((s) => [s.ledgerId, s.toMemberId, s.amount]).sort()).toEqual([
      ["L1", "m_bob", 5_000],
      ["L2", "n_cy", 3_000],
    ]);
    // the guest has no VPA, so that obligation is reported rather than dropped
    expect(body.skipped).toEqual([{ ledgerId: "L1", memberId: "m_guest", guestName: "Dee", amount: 2_000 }]);

    // every ledger still sums to zero, and only the guest debt remains
    for (const ledgerId of ["L1", "L2"]) {
      const net = [...(await positions(ledgerId)).values()];
      expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    }
    const l1 = await positions("L1");
    expect(l1.get("m_bob")).toBe(0);
    expect(l1.get("m_ada")).toBe(-2_000);
    expect(l1.get("m_guest")).toBe(2_000);
    expect((await positions("L2")).get("n_ada")).toBe(0);
  });

  it("narrows to one friend when toUserId is given", async () => {
    await owingEverywhere();
    const res = await app.request(
      req(h, "/api/settlements/bulk", { method: "POST", json: { toUserId: "u_cy", method: "upi", note: null } }),
    );
    const body = (await res.json()) as { total: number; settlements: Array<{ ledgerId: string }> };
    expect(body.total).toBe(3_000);
    expect(body.settlements.map((s) => s.ledgerId)).toEqual(["L2"]);
    expect(await h.db.listSettlements("L1")).toHaveLength(0);
  });

  it("writes nothing when the viewer owes nothing", async () => {
    const res = await app.request(req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }));
    const body = (await res.json()) as { total: number; settlements: unknown[] };
    expect(body.total).toBe(0);
    expect(body.settlements).toHaveLength(0);
    expect(await h.db.listSettlements("L1")).toHaveLength(0);
    expect(await h.db.listSettlements("L2")).toHaveLength(0);
  });

  it("401s without a session", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/settlements/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "upi", note: null }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import balancesRouter from "~/server/routes/balances";
import expensesRouter from "~/server/routes/expenses";
import settlementsRouter from "~/server/routes/settlements";
import { netPositions } from "~/server/balances";
import { type Harness, mount, NOW, req, setup } from "~/server/routes/_test-harness";

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
      json: {
        description: "x",
        paidAtEpochMs: 1_760_000_000_000,
        categoryId: null,
        notes: null,
        mode: "equal",
        ...body,
      },
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
  expense("L1", {
    total: 10_000,
    payerMemberId: "m_bob",
    participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
  });

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
    const res = await settle("L1", {
      fromMemberId: "m_ada",
      toMemberId: "m_bob",
      amount: 5_000,
      method: "forgiven",
      note: "on me",
    });
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
    const res = await app.request(req(h, `/api/ledgers/L1/settlements/${row!.id}/acknowledge`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await h.db.listSettlements("L1"))[0]!.acknowledgedAt).toBeGreaterThan(0);
    // the money did not move
    expect(await positions("L1")).toEqual(before);
  });
});

describe("net positions sum to zero", () => {
  it("after any sequence of expenses, refunds and settlements", async () => {
    await expense("L1", {
      total: 10_001,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }],
    }); // ₹100.01
    await expense("L1", {
      total: 7_777,
      payerMemberId: "m_guest",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    }); // ₹77.77
    await expense("L1", {
      mode: "percent",
      total: 9_999,
      payerMemberId: "m_bob",
      participants: [
        { memberId: "m_ada", value: 33 },
        { memberId: "m_bob", value: 33 },
        { memberId: "m_guest", value: 34 },
      ],
    }); // ₹99.99
    await expense("L1", {
      total: -2_500,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    }); // -₹25.00 refund
    await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 1_234 }); // ₹12.34
    await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_guest", amount: 99, method: "forgiven" }); // ₹0.99

    const net = [...(await positions("L1")).values()];
    expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    expect(net.every(Number.isInteger)).toBe(true);
  });
});

it("refuses a settlement on an archived ledger", async () => {
  await adaOwesBob();
  await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 }); // ₹50.00, so it can be archived
  h.sql.prepare("UPDATE ledgers SET archived_at = ? WHERE id = 'L1'").run(Date.now());

  const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 1_000 });
  expect(res.status).toBe(409);
  expect(await h.db.listSettlements("L1")).toHaveLength(1);
  // SPEC §12: an archived ledger has every net position at zero, and stays there.
  expect([...(await positions("L1")).values()].every((n) => n === 0)).toBe(true);
});

/** Ada owes Bob ₹50.00 and the guest ₹20.00 in L1, and Cy ₹30.00 in L2. */
async function owingEverywhere() {
  await adaOwesBob();
  await expense("L1", {
    total: 4_000,
    payerMemberId: "m_guest",
    participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }],
  }); // ₹40.00
  await expense("L2", {
    total: 6_000,
    payerMemberId: "n_cy",
    participants: [{ memberId: "n_ada" }, { memberId: "n_cy" }],
  }); // ₹60.00
}

describe("POST /settlements/bulk", () => {
  it("writes into every contributing ledger and skips guests explicitly", async () => {
    await owingEverywhere();
    const res = await app.request(
      req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      settlements: Array<{ ledgerId: string; toMemberId: string; amount: number }>;
      skipped: Array<{ ledgerId: string; memberId: string; guestName: string | null; amount: number; reason: string }>;
    };

    expect(body.total).toBe(8_000); // ₹50.00 + ₹30.00
    expect(body.settlements.map((s) => [s.ledgerId, s.toMemberId, s.amount]).sort()).toEqual([
      ["L1", "m_bob", 5_000],
      ["L2", "n_cy", 3_000],
    ]);
    // the guest has no VPA, so that obligation is reported rather than dropped
    expect(body.skipped).toEqual([
      { ledgerId: "L1", memberId: "m_guest", guestName: "Dee", amount: 2_000, reason: "guest" },
    ]);

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

  it("leaves an archived ledger alone - it is read-only and settled by definition", async () => {
    await owingEverywhere();
    h.sql.prepare("UPDATE ledgers SET archived_at = ? WHERE id = 'L2'").run(Date.now());

    const res = await app.request(
      req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }),
    );
    const body = (await res.json()) as { total: number; settlements: Array<{ ledgerId: string }> };
    expect(body.settlements.map((s) => s.ledgerId)).toEqual(["L1"]);
    expect(await h.db.listSettlements("L2")).toHaveLength(0);
  });

  it("writes nothing when the viewer owes nothing", async () => {
    const res = await app.request(
      req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }),
    );
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

describe("a settlement never exceeds what the payer owes or the payee is owed", () => {
  it("accepts exactly the amount owed", async () => {
    await adaOwesBob();
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 }); // ₹50.00
    expect(res.status).toBe(201);
    expect((await positions("L1")).get("m_ada")).toBe(0);
  });

  it("rejects one paisa more than the payer owes", async () => {
    await adaOwesBob();
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_001 }); // ₹50.01
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "over_settlement" });
    expect(await h.db.listSettlements("L1")).toHaveLength(0);
  });

  it("bounds a partial settle by what remains, not the original debt", async () => {
    await adaOwesBob();
    await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 3_000 }); // ₹30.00
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 2_001 })).status).toBe(400);
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 2_000 })).status).toBe(201);
  });

  it("rejects a settlement when the payer owes nothing, flipping no one", async () => {
    await adaOwesBob();
    const res = await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 1_000 });
    expect(res.status).toBe(400);
    expect((await positions("L1")).get("m_ada")).toBe(-5_000);
  });

  it("applies to `forgiven` too", async () => {
    await adaOwesBob();
    const res = await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_001, method: "forgiven" });
    expect(res.status).toBe(400);
  });
});

describe("bulk settle: departed members, unresolvable legs, double submit", () => {
  const bulk = () =>
    app.request(req(h, "/api/settlements/bulk", { method: "POST", json: { method: "upi", note: null } }));

  it("settles a departed member's leg like any other user", async () => {
    await owingEverywhere();
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = 'n_cy'").run(NOW);

    const body = (await (await bulk()).json()) as { total: number; settlements: Array<{ ledgerId: string }> };
    expect(body.total).toBe(8_000); // ₹50.00 + ₹30.00, Cy included
    expect(body.settlements.map((s) => s.ledgerId).sort()).toEqual(["L1", "L2"]);
    expect((await positions("L2")).get("n_ada")).toBe(0);
  });

  it("lists a leg with no resolvable user in skipped, with a reason", async () => {
    await owingEverywhere();
    h.sql.prepare("UPDATE users SET deleted_at = ? WHERE id = 'u_cy'").run(NOW);

    const body = (await (await bulk()).json()) as {
      total: number;
      skipped: Array<Record<string, unknown>>;
    };
    expect(body.total).toBe(5_000); // ₹50.00 to Bob only
    expect(body.skipped).toEqual(
      expect.arrayContaining([{ ledgerId: "L2", memberId: "n_cy", guestName: null, amount: 3_000, reason: "no_user" }]),
    );
    expect(await h.db.listSettlements("L2")).toHaveLength(0);
  });

  it("two bulk settles planned from the same state write each leg once", async () => {
    await owingEverywhere();
    const [a, b] = await Promise.all([bulk(), bulk()]);
    const totals = [a, b].map(async (r) => ((await r.json()) as { total: number }).total);
    expect((await Promise.all(totals)).reduce((x, y) => x + y, 0)).toBe(8_000);

    expect(await h.db.listSettlements("L1")).toHaveLength(1);
    expect(await h.db.listSettlements("L2")).toHaveLength(1);
    expect((await positions("L1")).get("m_bob")).toBe(0); // the guest's ₹20.00 is skipped, not settled
    expect((await positions("L1")).get("m_ada")).toBe(-2_000);
    expect((await positions("L2")).get("n_ada")).toBe(0);
  });

  it("the data-layer write writes nothing for an identical row declared moments earlier", async () => {
    const leg = {
      ledgerId: "L1",
      fromMemberId: "m_ada",
      toMemberId: "m_bob",
      amount: 5_000, // ₹50.00
      method: "upi" as const,
      note: null,
      declaredBy: "u_ada",
    };
    const first = await h.db.batch([h.db.insertSettlementOnce({ ...leg, id: "s1", declaredAt: NOW })]);
    const second = await h.db.batch([h.db.insertSettlementOnce({ ...leg, id: "s2", declaredAt: NOW + 1_000 })]);
    expect((first[0] as { meta: { changes: number } }).meta.changes).toBe(1);
    expect((second[0] as { meta: { changes: number } }).meta.changes).toBe(0);
    expect((await h.db.listSettlements("L1")).map((s) => s.id)).toEqual(["s1"]);
  });

  it("insertSettlementOnce writes every column in order", async () => {
    const declaredAt = Date.now();
    await h.db.batch([
      h.db.insertSettlementOnce({
        id: "s1",
        ledgerId: "L1",
        fromMemberId: "m_ada",
        toMemberId: "m_bob",
        amount: 5_000, // ₹50.00
        method: "upi",
        note: "lunch",
        declaredBy: "u_ada",
        declaredAt,
      }),
    ]);
    const row = h.sql.prepare("SELECT * FROM settlements WHERE id = ?").all("s1");
    expect(row).toEqual([
      {
        id: "s1",
        ledger_id: "L1",
        from_member_id: "m_ada",
        to_member_id: "m_bob",
        amount: 5_000,
        currency: "INR",
        method: "upi",
        note: "lunch",
        declared_by: "u_ada",
        declared_at: declaredAt,
        acknowledged_at: null,
        deleted_at: null,
      },
    ]);
  });

  it("reports a leg an identical recent settlement already covered as skipped, duplicate", async () => {
    await adaOwesBob();
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 })).status).toBe(201);
    await adaOwesBob(); // Ada owes Bob ₹50.00 again

    const res = await app.request(
      req(h, "/api/settlements/bulk", { method: "POST", json: { method: "manual", note: null } }),
    );
    expect(await res.json()).toEqual({
      total: 0,
      settlements: [],
      skipped: [{ ledgerId: "L1", memberId: "m_bob", guestName: null, amount: 5_000, reason: "duplicate" }],
    });
    expect(await h.db.listSettlements("L1")).toHaveLength(1);
  });
});

describe("single settle and members who have left", () => {
  it("accepts a settlement to a departed member with a live position", async () => {
    await adaOwesBob();
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = 'm_bob'").run(NOW);
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 })).status).toBe(201);
  });

  it("rejects a settlement to a soft-deleted member", async () => {
    await adaOwesBob();
    h.sql.prepare("UPDATE ledger_members SET deleted_at = ? WHERE id = 'm_bob'").run(NOW);
    expect((await settle("L1", { fromMemberId: "m_ada", toMemberId: "m_bob", amount: 5_000 })).status).toBe(400);
  });
});

// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import expenses from "~/server/routes/expenses";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expenses);
});

const base = {
  description: "Dinner",
  paidAtEpochMs: 1_760_000_000_000,
  categoryId: null,
  notes: null,
  payerMemberId: "m_ada",
};

const create = (body: object, ledgerId = "L1") =>
  app.request(req(h, `/api/ledgers/${ledgerId}/expenses`, { method: "POST", json: { ...base, ...body } }));

describe("POST /ledgers/:ledgerId/expenses", () => {
  it("stores splits summing exactly to the total, in all four modes", async () => {
    const cases = [
      // ₹100.01 three ways - 1 paise remainder, absorbed by the payer
      { mode: "equal", total: 10_001, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }] },
      // ₹120.00 stated exactly
      { mode: "exact", total: 12_000, participants: [{ memberId: "m_ada", value: 5_000 }, { memberId: "m_bob", value: 7_000 }] },
      // ₹100.00 in 1:2 shares
      { mode: "shares", total: 10_000, participants: [{ memberId: "m_ada", value: 1 }, { memberId: "m_bob", value: 2 }] },
      // ₹99.99 at 33/33/34
      { mode: "percent", total: 9_999, participants: [{ memberId: "m_ada", value: 33 }, { memberId: "m_bob", value: 33 }, { memberId: "m_guest", value: 34 }] },
    ];

    for (const c of cases) {
      const res = await create(c);
      expect(res.status, c.mode).toBe(201);
      const body = (await res.json()) as { total: number; mode: string; splits: Array<{ amount: number }> };
      expect(body.mode).toBe(c.mode);
      expect(body.splits).toHaveLength(c.participants.length);
      expect(body.splits.reduce((a, s) => a + s.amount, 0)).toBe(c.total);
      expect(body.splits.every((s) => Number.isInteger(s.amount))).toBe(true);
    }
  });

  it("keeps participants in stable order and gives the remainder to the payer", async () => {
    // payer is m_bob, second in the participant list - the remainder follows the
    // payer, not the first participant.
    const res = await create({
      payerMemberId: "m_bob",
      mode: "equal",
      total: 10_001, // ₹100.01
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }],
    });
    const body = (await res.json()) as { splits: Array<{ memberId: string; amount: number }> };
    expect(body.splits.map((s) => s.memberId)).toEqual(["m_ada", "m_bob", "m_guest"]);
    expect(body.splits.map((s) => s.amount)).toEqual([3_333, 3_335, 3_333]);
  });

  it("persists the mode and each participant's raw input so the editor reopens unchanged", async () => {
    const res = await create({
      mode: "shares",
      total: 10_000, // ₹100.00
      participants: [{ memberId: "m_ada", value: 1 }, { memberId: "m_bob", value: 3 }],
    });
    const body = (await res.json()) as { mode: string; splits: Array<{ inputValue: number | null }> };
    expect(body.mode).toBe("shares");
    expect(body.splits.map((s) => s.inputValue)).toEqual([1, 3]);
  });

  it("accepts a payer who is not a participant, including a guest", async () => {
    const res = await create({
      payerMemberId: "m_guest",
      mode: "equal",
      total: 10_001, // ₹100.01 - remainder falls to the first participant
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { splits: Array<{ amount: number }> };
    expect(body.splits.map((s) => s.amount)).toEqual([5_001, 5_000]);
  });

  it("takes a refund down the same path, with no special case", async () => {
    const res = await create({
      description: "Hotel refund",
      mode: "equal",
      total: -9_000, // -₹90.00
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { total: number; splits: Array<{ amount: number }> };
    expect(body.total).toBe(-9_000);
    expect(body.splits.reduce((a, s) => a + s.amount, 0)).toBe(-9_000);
  });

  it("rejects a participant belonging to a different ledger", async () => {
    // n_cy is a member of L2, not L1. requireMember does not catch this.
    const res = await create({
      mode: "equal",
      total: 10_000, // ₹100.00
      participants: [{ memberId: "m_ada" }, { memberId: "n_cy" }],
    });
    expect(res.status).toBe(400);
    expect(await h.db.listExpenses("L1")).toHaveLength(0);
  });

  it("rejects a payer belonging to a different ledger", async () => {
    const res = await create({
      payerMemberId: "n_cy",
      mode: "equal",
      total: 10_000, // ₹100.00
      participants: [{ memberId: "m_ada" }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects percentages that do not sum to 100", async () => {
    const res = await create({
      mode: "percent",
      total: 10_000, // ₹100.00
      participants: [{ memberId: "m_ada", value: 40 }, { memberId: "m_bob", value: 40 }],
    });
    expect(res.status).toBe(400);
    expect(await h.db.listExpenses("L1")).toHaveLength(0);
  });

  it("rejects exact amounts that do not sum to the total", async () => {
    const res = await create({
      mode: "exact",
      total: 10_000, // ₹100.00
      participants: [{ memberId: "m_ada", value: 4_000 }, { memberId: "m_bob", value: 5_000 }],
    });
    expect(res.status).toBe(400);
    expect(await h.db.listExpenses("L1")).toHaveLength(0);
  });

  it("rejects a zero total at the API boundary", async () => {
    const res = await create({ mode: "equal", total: 0, participants: [{ memberId: "m_ada" }] });
    expect(res.status).toBe(400);
  });

  it("403s a caller who is not a member of the ledger", async () => {
    // Ada is in L1 and L2; there is no ledger she is absent from, so use an
    // unknown ledger id - requireMember cannot find a membership either way.
    const res = await create({ mode: "equal", total: 100, participants: [{ memberId: "m_ada" }] }, "L_nope");
    expect(res.status).toBe(403);
  });
});

describe("PATCH /ledgers/:ledgerId/expenses/:expenseId", () => {
  const createOne = () =>
    create({ mode: "equal", total: 10_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00

  it("writes a revision snapshot of the prior state on every edit", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    expect(await h.db.listRevisions(id)).toHaveLength(0);

    const res = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, description: "Dinner (corrected)", mode: "equal", total: 12_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }, // ₹120.00
      }),
    );
    expect(res.status).toBe(200);

    const revisions = await h.db.listRevisions(id);
    expect(revisions).toHaveLength(1);
    const prior = JSON.parse(revisions[0]!.snapshot) as { total: number; description: string; splits: unknown[] };
    expect(prior.total).toBe(10_000);
    expect(prior.description).toBe("Dinner");
    expect(prior.splits).toHaveLength(2);

    // and a second edit appends rather than replaces
    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, mode: "equal", total: 13_000, participants: [{ memberId: "m_ada" }] }, // ₹130.00
      }),
    );
    expect(await h.db.listRevisions(id)).toHaveLength(2);
  });

  it("replaces the split set rather than accumulating it", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    const res = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, mode: "exact", total: 10_000, participants: [{ memberId: "m_guest", value: 10_000 }] }, // ₹100.00
      }),
    );
    const body = (await res.json()) as { mode: string; splits: Array<{ memberId: string; amount: number }> };
    expect(body.splits).toEqual([{ memberId: "m_guest", amount: 10_000, inputValue: 10_000 }]);
    expect(body.mode).toBe("exact");
  });

  it("leaves the expense untouched when the edit is invalid", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    const res = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, mode: "percent", total: 10_000, participants: [{ memberId: "m_ada", value: 10 }] },
      }),
    );
    expect(res.status).toBe(400);
    const after = await h.db.findExpense("L1", id);
    expect(after!.total).toBe(10_000);
    expect(await h.db.listRevisions(id)).toHaveLength(0);
  });

  it("404s an expense from another ledger", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    const res = await app.request(
      req(h, `/api/ledgers/L2/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, payerMemberId: "n_ada", mode: "equal", total: 100, participants: [{ memberId: "n_ada" }] },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /ledgers/:ledgerId/expenses (search & filter)", () => {
  const list = (qs: string) => app.request(req(h, `/api/ledgers/L1/expenses?${qs}`));

  it("returns everything, unchanged, with no params", async () => {
    await create({ description: "Dinner", mode: "equal", total: 1_000, participants: [{ memberId: "m_ada" }] });
    await create({ description: "Taxi", mode: "equal", total: 2_000, participants: [{ memberId: "m_bob" }] });
    const withParams = await app.request(req(h, "/api/ledgers/L1/expenses"));
    const plain = await app.request(req(h, "/api/ledgers/L1/expenses"));
    const withParamsBody = await withParams.json();
    expect(withParamsBody).toEqual(await plain.json());
    expect(withParamsBody as unknown[]).toHaveLength(2);
  });

  it("matches q against description and notes, literally on a %", async () => {
    await create({ description: "50% off dinner", mode: "equal", total: 1_000, participants: [{ memberId: "m_ada" }] });
    await create({ description: "Groceries", notes: "had a 50% coupon", mode: "equal", total: 500, participants: [{ memberId: "m_ada" }] });
    await create({ description: "Something else entirely", mode: "equal", total: 700, participants: [{ memberId: "m_ada" }] });

    const res = await list("q=" + encodeURIComponent("50%"));
    const body = (await res.json()) as Array<{ description: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((b) => b.description).sort()).toEqual(["50% off dinner", "Groceries"]);
  });

  it("filters by categoryId", async () => {
    await create({ description: "Lunch", categoryId: "cat_food", mode: "equal", total: 1_000, participants: [{ memberId: "m_ada" }] });
    await create({ description: "Bus", categoryId: "cat_transport", mode: "equal", total: 500, participants: [{ memberId: "m_ada" }] });

    const res = await list("categoryId=cat_food");
    const body = (await res.json()) as Array<{ description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.description).toBe("Lunch");
  });

  it("filters by from/to date range", async () => {
    await create({ description: "Early", paidAtEpochMs: 1_000, mode: "equal", total: 1_000, participants: [{ memberId: "m_ada" }] });
    await create({ description: "Late", paidAtEpochMs: 9_000, mode: "equal", total: 1_000, participants: [{ memberId: "m_ada" }] });

    const res = await list("from=5000&to=10000");
    const body = (await res.json()) as Array<{ description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.description).toBe("Late");
  });

  it("rejects a non-integer from/to with 400", async () => {
    const res = await list("from=notanumber");
    expect(res.status).toBe(400);
  });

  it("filters by memberId, matching both payer and participant", async () => {
    // Bob pays, Ada + guest participate.
    await create({
      description: "Bob paid",
      payerMemberId: "m_bob",
      mode: "equal",
      total: 2_000,
      participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }],
    });
    // Ada pays, Bob is not involved at all.
    await create({
      description: "Ada solo",
      mode: "equal",
      total: 1_000,
      participants: [{ memberId: "m_ada" }],
    });

    const res = await list("memberId=m_bob");
    const body = (await res.json()) as Array<{ description: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.description).toBe("Bob paid");

    const resAda = await list("memberId=m_ada");
    const bodyAda = (await resAda.json()) as Array<{ description: string }>;
    expect(bodyAda).toHaveLength(2);
  });
});

describe("GET /ledgers/:ledgerId/expenses/:expenseId/revisions", () => {
  it("returns revisions newest-first with parsed snapshots and reviser names", async () => {
    const { id } = (await (
      await create({ mode: "equal", total: 10_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹100.00
    ).json()) as { id: string };

    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, description: "v2", mode: "equal", total: 12_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }, // ₹120.00
      }),
    );
    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, description: "v3", mode: "equal", total: 13_000, participants: [{ memberId: "m_ada" }] }, // ₹130.00
      }),
    );

    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/revisions`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ revisedByName: string; snapshot: { description: string } }>;
    expect(body).toHaveLength(2);
    expect(body[0]!.snapshot.description).toBe("v2"); // newest first: state before the v3 edit
    expect(body[1]!.snapshot.description).toBe("Dinner"); // state before the v2 edit
    expect(body.every((r) => r.revisedByName === "Ada")).toBe(true);
  });
});

describe("POST /ledgers/:ledgerId/expenses/:expenseId/undo", () => {
  const createOne = () =>
    create({ description: "Dinner", mode: "equal", total: 10_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }); // ₹100.00

  it("400s when there are no revisions", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/undo`, { method: "POST" }));
    expect(res.status).toBe(400);
  });

  it("restores the previous description, total and splits, still summing to the total", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, description: "Dinner (edited)", mode: "exact", total: 15_000, participants: [{ memberId: "m_ada", value: 15_000 }] }, // ₹150.00
      }),
    );

    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/undo`, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description: string; total: number; splits: Array<{ amount: number }> };
    expect(body.description).toBe("Dinner");
    expect(body.total).toBe(10_000);
    expect(body.splits.reduce((a, s) => a + s.amount, 0)).toBe(10_000);
  });

  it("undoes a delete, bringing the expense back", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));
    expect(await h.db.findExpense("L1", id)).toBeUndefined();

    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/undo`, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description: string; total: number };
    expect(body.description).toBe("Dinner");
    expect(body.total).toBe(10_000);
    expect(await h.db.findExpense("L1", id)).toBeDefined();
  });

  it("is itself undoable: undoing twice returns to the state before the first undo", async () => {
    const { id } = (await (await createOne()).json()) as { id: string };
    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: { ...base, description: "Dinner (edited)", mode: "equal", total: 20_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }, // ₹200.00
      }),
    );

    const first = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/undo`, { method: "POST" }));
    expect(((await first.json()) as { description: string }).description).toBe("Dinner");

    const second = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/undo`, { method: "POST" }));
    expect(second.status).toBe(200);
    const body = (await second.json()) as { description: string; total: number };
    expect(body.description).toBe("Dinner (edited)");
    expect(body.total).toBe(20_000);
  });
});

describe("DELETE /ledgers/:ledgerId/expenses/:expenseId", () => {
  it("soft-deletes: the row survives, the read path stops returning it", async () => {
    const { id } = (await (
      await create({ mode: "equal", total: 10_000, participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] }) // ₹100.00
    ).json()) as { id: string };

    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));
    expect(res.status).toBe(200);

    expect(await h.db.listExpenses("L1")).toHaveLength(0);
    expect(await h.db.findExpense("L1", id)).toBeUndefined();
    const raw = h.sql.prepare("SELECT deleted_at FROM expenses WHERE id = ?").all(id) as Array<{ deleted_at: number }>;
    expect(raw).toHaveLength(1);
    expect(raw[0]!.deleted_at).toBeGreaterThan(0);
  });
});

// The feed is DERIVED, so the thing worth testing is that it reports what
// actually happened — including the two categories of row every other read path
// deliberately hides: soft-deleted expenses and members who have left.
//
// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import activity, { type ActivityEvent } from "~/server/routes/activity";
import comments from "~/server/routes/comments";
import expenses from "~/server/routes/expenses";
import ledgers from "~/server/routes/ledgers";
import settlements from "~/server/routes/settlements";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expenses, comments, settlements, ledgers, activity);
});

const createExpense = async (ledgerId: string, over: object = {}) => {
  const res = await app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: {
        description: "Dinner",
        paidAtEpochMs: 1_760_000_000_000,
        categoryId: null,
        notes: null,
        payerMemberId: "m_ada",
        mode: "equal",
        total: 10_000, // ₹100.00
        participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
        ...over,
      },
    }),
  );
  return (await res.json()) as { id: string };
};

const feed = async (ledgerId = "L1") => {
  const res = await app.request(req(h, `/api/ledgers/${ledgerId}/activity`));
  expect(res.status).toBe(200);
  return (await res.json()) as ActivityEvent[];
};

const kinds = (events: ActivityEvent[]) => events.map((e) => e.kind);

describe("GET /ledgers/:ledgerId/activity", () => {
  it("reports member joins on a fresh ledger and nothing else", async () => {
    const events = await feed();
    expect(new Set(kinds(events))).toEqual(new Set(["joined"]));
    // Ada, Bob and the guest Dee
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.actorName).sort()).toEqual(["Ada", "Bob", "Dee"]);
  });

  it("reports an added expense with its actor, description and amount", async () => {
    await createExpense("L1", { description: "Goa flights", total: 450_000 }); // ₹4,500
    const added = (await feed()).find((e) => e.kind === "added");
    expect(added).toMatchObject({
      kind: "added",
      actorName: "Ada",
      description: "Goa flights",
      amount: 450_000, // ₹4,500
    });
  });

  it("reports an edit as `edited`, not as a second `added`", async () => {
    const { id } = await createExpense("L1");
    await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}`, {
        method: "PATCH",
        json: {
          description: "Dinner (fixed)",
          paidAtEpochMs: 1_760_000_000_000,
          categoryId: null,
          notes: null,
          payerMemberId: "m_ada",
          mode: "equal",
          total: 12_000, // ₹120.00
          participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
        },
      }),
    );
    const events = await feed();
    expect(kinds(events).filter((k) => k === "added")).toHaveLength(1);
    expect(kinds(events).filter((k) => k === "edited")).toHaveLength(1);
    expect(events.find((e) => e.kind === "edited")?.actorName).toBe("Ada");
  });

  // A feed that hides deletions is lying about what happened.
  it("reports a deleted expense, which every other read path hides", async () => {
    const { id } = await createExpense("L1", { description: "Mistake" });
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));

    const events = await feed();
    const deleted = events.find((e) => e.kind === "deleted");
    expect(deleted).toBeDefined();
    expect(deleted).toMatchObject({ description: "Mistake", actorName: "Ada" });
  });

  it("does not double-count a delete as both `deleted` and `edited`", async () => {
    const { id } = await createExpense("L1");
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}`, { method: "DELETE" }));

    const events = await feed();
    expect(kinds(events).filter((k) => k === "deleted")).toHaveLength(1);
    // The delete writes a revision, but that revision IS the deletion.
    expect(kinds(events).filter((k) => k === "edited")).toHaveLength(0);
  });

  it("reports a settlement with both member names and the amount", async () => {
    await app.request(
      req(h, "/api/ledgers/L1/settlements", {
        method: "POST",
        json: { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 5_000, method: "manual", note: null }, // ₹50.00
      }),
    );
    const settled = (await feed()).find((e) => e.kind === "settled");
    expect(settled).toMatchObject({ fromName: "Bob", toName: "Ada", amount: 5_000 }); // ₹50.00
  });

  it("distinguishes a forgiven settlement from a payment", async () => {
    await app.request(
      req(h, "/api/ledgers/L1/settlements", {
        method: "POST",
        json: { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 5_000, method: "forgiven", note: null }, // ₹50.00
      }),
    );
    const events = await feed();
    expect(kinds(events)).toContain("forgave");
    expect(kinds(events)).not.toContain("settled");
  });

  it("reports a comment against the expense it was made on", async () => {
    const { id } = await createExpense("L1", { description: "Cab" });
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "who paid?" } }));

    const commented = (await feed()).find((e) => e.kind === "commented");
    expect(commented).toMatchObject({ actorName: "Ada", description: "Cab", expenseId: id });
  });

  it("reports a member who left, which listMembers hides", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(1_760_000_500_000, "m_bob");
    const events = await feed();
    const left = events.find((e) => e.kind === "left");
    expect(left).toMatchObject({ actorName: "Bob", at: 1_760_000_500_000 });
    // and joining is still reported for the same person
    expect(events.filter((e) => e.kind === "joined" && e.actorName === "Bob")).toHaveLength(1);
  });

  it("orders newest first", async () => {
    await createExpense("L1", { description: "One" });
    await createExpense("L1", { description: "Two" });
    const events = await feed();
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.at).toBeGreaterThanOrEqual(events[i]!.at);
    }
  });

  it("never leaks another ledger's events", async () => {
    await createExpense("L1", { description: "L1 only" });
    const l2 = await feed("L2");
    expect(l2.every((e) => e.description !== "L1 only")).toBe(true);
  });

  it("refuses a non-member", async () => {
    // L2 contains Ada and Cy; a ledger Ada is not in must not be readable.
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(1, "n_ada");
    const res = await app.request(req(h, "/api/ledgers/L2/activity"));
    expect(res.status).toBe(403);
  });

  it("rejects a nonsense limit", async () => {
    const res = await app.request(req(h, "/api/ledgers/L1/activity?limit=0"));
    expect(res.status).toBe(400);
  });

  it("honours a limit", async () => {
    await createExpense("L1");
    const res = await app.request(req(h, "/api/ledgers/L1/activity?limit=2"));
    expect((await res.json()) as ActivityEvent[]).toHaveLength(2);
  });
});

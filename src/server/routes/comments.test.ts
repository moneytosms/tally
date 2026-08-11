// Amounts are paise, written as integers with the rupee value in a comment.
import { beforeEach, describe, expect, it } from "vitest";
import comments from "~/server/routes/comments";
import expenses from "~/server/routes/expenses";
import ledgers from "~/server/routes/ledgers";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, expenses, comments, ledgers);
});

async function createExpense(ledgerId: string, payerMemberId: string, participants: Array<{ memberId: string }>) {
  const res = await app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: {
        description: "Dinner",
        paidAtEpochMs: 1_760_000_000_000,
        categoryId: null,
        notes: null,
        payerMemberId,
        mode: "equal",
        total: 10_000, // ₹100.00
        participants,
      },
    }),
  );
  return (await res.json()) as { id: string };
}

describe("GET /ledgers/:ledgerId/expenses/:expenseId/comments", () => {
  it("returns comments oldest-first with author names", async () => {
    const { id } = await createExpense("L1", "m_ada", [{ memberId: "m_ada" }, { memberId: "m_bob" }]);
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "first" } }));
    await app.request(req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "second" } }));

    const res = await app.request(req(h, `/api/ledgers/L1/expenses/${id}/comments`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ body: string; authorName: string }>;
    expect(body.map((c) => c.body)).toEqual(["first", "second"]);
    expect(body.every((c) => c.authorName === "Ada")).toBe(true);
  });
});

describe("POST /ledgers/:ledgerId/expenses/:expenseId/comments", () => {
  it("creates a comment", async () => {
    const { id } = await createExpense("L1", "m_ada", [{ memberId: "m_ada" }]);
    const res = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "nice one" } }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { body: string; authorUserId: string };
    expect(body.body).toBe("nice one");
    expect(body.authorUserId).toBe("u_ada");
  });

  it("cannot be posted to an expense in another ledger", async () => {
    const { id } = await createExpense("L2", "n_ada", [{ memberId: "n_ada" }]);
    const res = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "sneaky" } }),
    );
    expect(res.status).toBe(404);
  });

  it("is refused on an archived ledger", async () => {
    const { id } = await createExpense("L2", "n_ada", [{ memberId: "n_ada" }]);
    // Settle nothing owed so L2 (Ada + Cy, no expense split imbalance from a
    // single-participant expense paid by that same participant) can archive.
    const archiveRes = await app.request(req(h, "/api/ledgers/L2/archive", { method: "POST" }));
    expect(archiveRes.status).toBe(200);

    const res = await app.request(
      req(h, `/api/ledgers/L2/expenses/${id}/comments`, { method: "POST", json: { body: "too late" } }),
    );
    expect(res.status).toBe(409);
  });
});

describe("DELETE /ledgers/:ledgerId/comments/:commentId", () => {
  it("only the author may delete their comment", async () => {
    const { id } = await createExpense("L1", "m_ada", [{ memberId: "m_ada" }]);
    const createRes = await app.request(
      req(h, `/api/ledgers/L1/expenses/${id}/comments`, { method: "POST", json: { body: "Ada's comment" } }),
    );
    const { id: commentId } = (await createRes.json()) as { id: string };

    // Bob (not the author) tries to delete it.
    const bobToken = await (async () => {
      const { createSession, SESSION_COOKIE } = await import("~/server/auth/session");
      const token = await createSession(h.db, "u_bob", Date.now());
      return `${SESSION_COOKIE}=${token}`;
    })();
    const forbidden = await app.request(
      new Request(`http://tally.test/api/ledgers/L1/comments/${commentId}`, {
        method: "DELETE",
        headers: { cookie: bobToken },
      }),
    );
    expect(forbidden.status).toBe(403);

    const ok = await app.request(req(h, `/api/ledgers/L1/comments/${commentId}`, { method: "DELETE" }));
    expect(ok.status).toBe(200);
  });
});

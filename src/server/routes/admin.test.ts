// Instance invites and account deletion, over the real data-access layer.
// Seed (see _test-harness): Ada is the instance owner and the session; L1 holds
// Ada, Bob and the guest Dee.
import { beforeEach, describe, expect, it } from "vitest";
import admin from "~/server/routes/admin";
import ledgers from "~/server/routes/ledgers";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";
import { SESSION_COOKIE, createSession, sha256Hex } from "~/server/auth/session";
import { uuidv7 } from "~/shared/id";

let h: Harness;
let app: ReturnType<typeof mount>;

const RS_400 = 40_000; // ₹400.00 in paise

beforeEach(async () => {
  h = await setup();
  app = mount(h, admin, ledgers);
});

/** ₹400 hotel on L1 paid by Ada, split equally - Bob ends up ₹200 in debt. */
async function hotelOnL1() {
  const expenseId = uuidv7();
  await h.db.insertExpense({
    id: expenseId,
    ledgerId: "L1",
    description: "Hotel",
    total: RS_400,
    paidAt: Date.now(),
    payerMemberId: "m_ada",
    mode: "equal",
    createdBy: "u_ada",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await h.db.insertSplits([
    { id: uuidv7(), expenseId, memberId: "m_ada", amount: RS_400 / 2, sortOrder: 0 }, // ₹200.00
    { id: uuidv7(), expenseId, memberId: "m_bob", amount: RS_400 / 2, sortOrder: 1 }, // ₹200.00
  ]);
}

describe("POST /admin/invites", () => {
  it("mints a usable invite bound to no ledger", async () => {
    const res = await app.request(req(h, "/api/admin/invites", { method: "POST" }));
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string; expiresAt: number };

    const row = await h.db.findUsableInvite(await sha256Hex(token), Date.now());
    expect(row).toBeDefined();
    // Null ledgerId is the whole point: it admits them to tally, joins nothing.
    expect(row!.invite.ledgerId).toBeNull();
  });

  it("rejects a non-owner", async () => {
    const token = await createSession(h.db, "u_bob", Date.now());
    const res = await app.request(
      req(h, "/api/admin/invites", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    );
    expect(res.status).toBe(403);
  });
});

describe("emergency levers", () => {
  it("signs a user out of every device without touching the account", async () => {
    const token = await createSession(h.db, "u_bob", Date.now());
    expect(await h.db.findSessionByTokenHash(await sha256Hex(token), Date.now())).toBeDefined();

    const res = await app.request(req(h, "/api/admin/users/u_bob/sessions", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await h.db.findSessionByTokenHash(await sha256Hex(token), Date.now())).toBeUndefined();
    // Still a live account - sign-out is not deletion.
    expect(await h.db.findUserById("u_bob")).toBeDefined();
  });

  it("clears a password and the sessions it bought", async () => {
    await h.db.updateUser("u_bob", { email: "bob@example.com", passwordHash: "leaked-hash" });
    const token = await createSession(h.db, "u_bob", Date.now());

    const res = await app.request(req(h, "/api/admin/users/u_bob/password", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect((await h.db.findUserById("u_bob"))!.passwordHash).toBeNull();
    expect(await h.db.findSessionByTokenHash(await sha256Hex(token), Date.now())).toBeUndefined();
  });

  it("rejects a non-owner", async () => {
    const cookie = `${SESSION_COOKIE}=${await createSession(h.db, "u_bob", Date.now())}`;
    for (const path of ["/api/admin/users/u_ada/sessions", "/api/admin/users/u_ada/password"]) {
      expect((await app.request(req(h, path, { method: "DELETE", headers: { cookie } }))).status).toBe(403);
    }
  });
});

describe("DELETE /admin/users/:userId", () => {
  const del = (userId: string, cookie?: string) =>
    app.request(req(h, `/api/admin/users/${userId}`, { method: "DELETE", ...(cookie ? { headers: { cookie } } : {}) }));

  it("refuses while the account holds a non-zero position", async () => {
    await hotelOnL1();
    const res = await del("u_bob");
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "non_zero_position" });
    // Nothing half-applied: Bob is still a current member.
    expect((await h.db.listMembers("L1")).some((m) => m.userId === "u_bob")).toBe(true);
  });

  it("deletes a settled account and leaves its history in the totals", async () => {
    await hotelOnL1();
    // Bob pays Ada his ₹200.00 share back, zeroing both positions.
    await h.db.insertSettlement({
      id: uuidv7(),
      ledgerId: "L1",
      fromMemberId: "m_bob",
      toMemberId: "m_ada",
      amount: RS_400 / 2, // ₹200.00
      method: "manual",
      declaredBy: "u_bob",
      declaredAt: Date.now(),
    });

    const res = await del("u_bob");
    expect(res.status).toBe(200);
    expect(await h.db.findUserById("u_bob")).toBeUndefined();
    expect((await h.db.listMembers("L1")).some((m) => m.userId === "u_bob")).toBe(false);

    // Balances are derived, so the expense Bob was part of must still count.
    const ledger = (await (await app.request(req(h, "/api/ledgers/L1"))).json()) as { spent: number };
    expect(ledger.spent).toBe(RS_400);
  });

  it("refuses the owner and the caller", async () => {
    // Ada is both, so a second owner-only cookie is not needed to cover "owner".
    expect(((await (await del("u_ada")).json()) as { code: string }).code).toBe("owner");
  });

  it("rejects a non-owner", async () => {
    const token = await createSession(h.db, "u_bob", Date.now());
    expect((await del("u_cy", `${SESSION_COOKIE}=${token}`)).status).toBe(403);
  });
});

/** Owner-only, one-directional (ADR 0008): no demote route exists. */
describe("POST /admin/users/:userId/promote", () => {
  it("flips a restricted account to full", async () => {
    await h.db.updateUser("u_bob", { accountType: "restricted" });
    const res = await app.request(req(h, "/api/admin/users/u_bob/promote", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u_bob", accountType: "full" });
    expect((await h.db.findUserById("u_bob"))!.accountType).toBe("full");
  });

  it("rejects a non-owner", async () => {
    await h.db.updateUser("u_bob", { accountType: "restricted" });
    const token = await createSession(h.db, "u_cy", Date.now());
    const res = await app.request(
      req(h, "/api/admin/users/u_bob/promote", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect((await h.db.findUserById("u_bob"))!.accountType).toBe("restricted");
  });
});

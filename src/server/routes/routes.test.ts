// Route tests against the real app: Hono's app.request() over an in-memory
// node:sqlite migrated with the actual migration SQL. Same setup shape as
// src/server/auth/session.test.ts, plus a thin D1 shim so the real data-access
// layer (drizzle over D1) runs unchanged.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:sqlite is untyped here - @types/node is not a dependency
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./_test-harness";
import app from "~/server/index";
import { createDb } from "~/db";
import { SESSION_COOKIE, createSession, sha256Hex } from "~/server/auth/session";
import { serialiseUser } from "~/server/routes/me";
import { BOOTSTRAP_BURNED } from "~/server/routes/auth";
import { uuidv7 } from "~/shared/id";
import { ORIGIN } from "~/shared/rp-id";

const SECRET = "bootstrap-secret-value";
// Sessions slide against the real clock, so tests must live in the present.
const NOW = Date.now();
const RS_500 = 50_000; // ₹500.00 in paise

type Row = Record<string, unknown>;
type Stmt = {
  run(...p: unknown[]): { changes: number };
  all(...p: unknown[]): Row[] | unknown[][];
  setReturnArrays(on: boolean): void;
};
type Sqlite = { exec(sql: string): void; prepare(sql: string): Stmt };

/** The slice of D1 that drizzle's d1 driver actually calls, over node:sqlite.
 *  `raw()` must return POSITIONAL rows - a join selects `sessions.id` and
 *  `users.id`, and an object row would silently collapse them. */
function d1(sql: Sqlite) {
  const arrays = <T>(stmt: Stmt, fn: () => T): T => {
    stmt.setReturnArrays(true);
    try {
      return fn();
    } finally {
      stmt.setReturnArrays(false);
    }
  };
  const bound = (stmt: Stmt, params: unknown[]) => ({
    bind: (...p: unknown[]) => bound(stmt, p),
    run: async () => ({ success: true, meta: { changes: stmt.run(...params).changes } }),
    all: async () => ({ success: true, results: stmt.all(...params) }),
    raw: async () => arrays(stmt, () => stmt.all(...params) as unknown[][]),
    exec: () => ({ success: true, results: stmt.all(...params) }),
  });
  return {
    prepare: (query: string) => bound(sql.prepare(query), []),
    batch: async (stmts: { exec: () => unknown }[]) => stmts.map((s) => s.exec()),
  } as unknown as D1Database;
}

function setup() {
  const sql = new DatabaseSync(":memory:") as Sqlite;
  migrate(sql);
  const binding = d1(sql);
  return { sql, db: createDb(binding), env: { DB: binding, BOOTSTRAP_SECRET: SECRET } };
}

type Env = ReturnType<typeof setup>["env"];

const post = (env: Env, path: string, body?: unknown, cookie?: string) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body ?? {}),
    },
    env,
  );

const get = (env: Env, path: string, cookie?: string) =>
  app.request(path, { headers: cookie ? { cookie } : {} }, env);

const del = (env: Env, path: string, cookie?: string) =>
  app.request(path, { method: "DELETE", headers: cookie ? { cookie } : {} }, env);

/** A signed-in user, without going through WebAuthn. */
async function signIn(db: ReturnType<typeof createDb>, displayName: string, vpa: string | null = null) {
  const id = uuidv7();
  await db.insertUser({ id, displayName, vpa, isOwner: false, createdAt: NOW });
  const token = await createSession(db, id, NOW);
  return { id, cookie: `${SESSION_COOKIE}=${token}` };
}

/** A ledger with `owner` plus `other`, and one expense leaving `other` in debt. */
async function ledgerInDebt(env: Env, db: ReturnType<typeof createDb>, a: string, b: string) {
  const ledgerId = uuidv7();
  const [ma, mb] = [uuidv7(), uuidv7()];
  await db.insertLedger({ id: ledgerId, name: "Goa", createdBy: a, createdAt: NOW });
  await db.insertMember({ id: ma, ledgerId, userId: a, joinedAt: NOW });
  await db.insertMember({ id: mb, ledgerId, userId: b, joinedAt: NOW });

  const expenseId = uuidv7();
  await db.insertExpense({
    id: expenseId,
    ledgerId,
    description: "Hotel",
    total: RS_500,
    paidAt: NOW,
    payerMemberId: ma,
    mode: "equal",
    createdBy: a,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insertSplits([
    { id: uuidv7(), expenseId, memberId: ma, amount: RS_500 / 2, sortOrder: 0 },
    { id: uuidv7(), expenseId, memberId: mb, amount: RS_500 / 2, sortOrder: 1 },
  ]);
  void env;
  return { ledgerId, ma, mb };
}

describe("auth", () => {
  // The secret is spent on the owner's first passkey, NOT on the claim. Claiming
  // and then failing to enrol must be retryable, or the instance is bricked: an
  // owner with no credential, a burned secret, and nobody who can invite anyone.
  it("re-claiming before enrolment re-attaches to the same owner", async () => {
    const { env, db } = setup();

    const first = await post(env, "/api/auth/bootstrap", { secret: SECRET, displayName: "Ada" });
    expect(first.status).toBe(201);
    expect(first.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);

    const second = await post(env, "/api/auth/bootstrap", { secret: SECRET, displayName: "Mallory" });
    expect(second.status).toBe(201);
    // Same account, not a second one, and the display name is not overwritten.
    const owners = (await db.listUsers()).filter((u) => u.isOwner);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.displayName).toBe("Ada");
  });

  it("rejects the wrong secret, and every claim once the secret is burned", async () => {
    const { env, db } = setup();

    const wrong = await post(env, "/api/auth/bootstrap", { secret: "nope", displayName: "Mallory" });
    expect(wrong.status).toBe(403);

    await post(env, "/api/auth/bootstrap", { secret: SECRET, displayName: "Ada" });
    await db.setInstanceState(BOOTSTRAP_BURNED, String(NOW), NOW);

    const after = await post(env, "/api/auth/bootstrap", { secret: SECRET, displayName: "Mallory" });
    expect(after.status).toBe(403);
    // Burned and wrong are indistinguishable: the response leaks nothing.
    expect(await after.json()).toEqual(await wrong.json());
  });

  it("serves /.well-known/webauthn listing the frozen origin", async () => {
    const { env } = setup();
    const res = await get(env, "/.well-known/webauthn");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ origins: [ORIGIN] });
  });

  it("does not register a stranger with no session and no invite", async () => {
    const { env } = setup();
    const res = await post(env, "/api/auth/register/options", { displayName: "Mallory" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not register with an invite token that does not exist", async () => {
    const { env } = setup();
    const res = await post(env, "/api/auth/register/options", {
      displayName: "Mallory",
      inviteToken: "not-a-real-token",
    });
    expect(res.status).toBe(403);
  });

  it("logout ends the caller's own session and clears the cookie", async () => {
    const { env, db } = setup();
    const user = await signIn(db, "Ada");

    // The session resolves before logout.
    expect((await get(env, "/api/me", user.cookie)).status).toBe(200);

    const res = await post(env, "/api/auth/logout", undefined, user.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);

    // Same cookie no longer resolves to anyone.
    expect((await get(env, "/api/me", user.cookie)).status).toBe(401);
  });

  it("logout with no session cookie is a harmless no-op", async () => {
    const { env } = setup();
    const res = await post(env, "/api/auth/logout");
    expect(res.status).toBe(200);
  });
});

describe("authorisation", () => {
  it("401s an unauthenticated ledger request", async () => {
    const { env } = setup();
    expect((await get(env, "/api/ledgers")).status).toBe(401);
    expect((await get(env, `/api/ledgers/${uuidv7()}`)).status).toBe(401);
    expect((await get(env, "/api/me")).status).toBe(401);
  });

  it("403s a non-member without leaking whether the ledger exists", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const stranger = await signIn(db, "Mallory");
    const { ledgerId } = await ledgerInDebt(env, db, a.id, (await signIn(db, "Bob")).id);

    const real = await get(env, `/api/ledgers/${ledgerId}`, stranger.cookie);
    const fake = await get(env, `/api/ledgers/${uuidv7()}`, stranger.cookie);
    expect(real.status).toBe(403);
    expect(fake.status).toBe(403);
    expect(await real.json()).toEqual(await fake.json());
  });
});

describe("ledgers", () => {
  it("creates a ledger with its creator as a member", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const res = await post(env, "/api/ledgers", { name: "Goa" }, a.cookie);
    expect(res.status).toBe(201);
    const ledger = (await res.json()) as { id: string; memberCount: number; net: number; spent: number };
    expect(ledger.memberCount).toBe(1);
    expect(ledger.net).toBe(0);
    expect(ledger.spent).toBe(0);

    const list = (await (await get(env, "/api/ledgers", a.cookie)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("refuses to archive while a net position is non-zero", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const b = await signIn(db, "Bob");
    const { ledgerId } = await ledgerInDebt(env, db, a.id, b.id);

    const res = await post(env, `/api/ledgers/${ledgerId}/archive`, {}, a.cookie);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "not_settled" });
    expect(((await db.findLedger(ledgerId))!).archivedAt).toBeNull();
  });

  it("refuses to let a member leave while their net position is non-zero", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const b = await signIn(db, "Bob");
    const { ledgerId, mb } = await ledgerInDebt(env, db, a.id, b.id);

    const res = await post(env, `/api/ledgers/${ledgerId}/leave`, {}, b.cookie);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "non_zero_position" });
    expect((await db.listMembers(ledgerId)).some((m) => m.id === mb)).toBe(true);
  });

  it("lets a settled member leave", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const res = await post(env, "/api/ledgers", { name: "Goa" }, a.cookie);
    const { id } = (await res.json()) as { id: string };
    expect((await post(env, `/api/ledgers/${id}/leave`, {}, a.cookie)).status).toBe(200);
    expect(await db.listMembers(id)).toHaveLength(0);
  });

  it("lets only the creator delete, and deletes softly", async () => {
    const { env, db, sql } = setup();
    const a = await signIn(db, "Ada");
    const b = await signIn(db, "Bob");
    const { ledgerId } = await ledgerInDebt(env, db, a.id, b.id);

    const refused = await del(env, `/api/ledgers/${ledgerId}`, b.cookie);
    expect(refused.status).toBe(403);
    expect(await db.findLedger(ledgerId)).toBeDefined();

    expect((await del(env, `/api/ledgers/${ledgerId}`, a.cookie)).status).toBe(200);
    expect(await db.findLedger(ledgerId)).toBeUndefined();
    // soft: the row is still there
    expect((sql.prepare("SELECT COUNT(*) AS n FROM ledgers").all() as Row[])[0]!.n).toBe(1);
  });

  it("guests are owner-created data with no user id", async () => {
    const { env, db } = setup();
    const ownerId = uuidv7();
    await db.insertUser({ id: ownerId, displayName: "Owner", isOwner: true, createdAt: NOW });
    const cookie = `${SESSION_COOKIE}=${await createSession(db, ownerId, NOW)}`;
    const member = await signIn(db, "Bob");

    const created = (await (await post(env, "/api/ledgers", { name: "Goa" }, cookie)).json()) as { id: string };
    const refused = await post(env, `/api/ledgers/${created.id}/guests`, { guestName: "Cara" }, member.cookie);
    expect(refused.status).toBe(403); // not even a member, let alone the owner

    const res = await post(env, `/api/ledgers/${created.id}/guests`, { guestName: "Cara" }, cookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: null, guestName: "Cara", nickname: "Cara" });
    // no session, no credential, no principal
    expect((await db.listMembers(created.id)).find((m) => m.guestName === "Cara")!.userId).toBeNull();
  });

  it("accepts an invite and joins its ledger, once", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada");
    const b = await signIn(db, "Bob");
    // invitesEnabled is opt-in (ADR 0007) - a ledger with it off can mint nothing.
    const created = (await (
      await post(env, "/api/ledgers", { name: "Goa", invitesEnabled: true }, a.cookie)
    ).json()) as { id: string };

    const invite = (await (
      await post(env, `/api/ledgers/${created.id}/invites`, {}, a.cookie)
    ).json()) as { token: string };

    expect((await post(env, `/api/invites/${invite.token}/accept`, {}, b.cookie)).status).toBe(201);
    expect(await db.listMembers(created.id)).toHaveLength(2);
    // single-use: already a member, so a replay by a third party gets nothing
    const c = await signIn(db, "Cara");
    expect((await post(env, `/api/invites/${invite.token}/accept`, {}, c.cookie)).status).toBe(400);
  });
});

describe("vpa visibility", () => {
  it("GET /api/me carries the caller's own VPA and no one else's", async () => {
    const { env, db } = setup();
    const a = await signIn(db, "Ada", "ada@bank");
    await signIn(db, "Bob", "bob@bank");

    const res = await get(env, "/api/me", a.cookie);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ displayName: "Ada", vpa: "ada@bank", isOwner: false });
    expect(body).not.toContain("bob@bank");
    expect(body).not.toContain("Bob");
  });

  it("the serialiser withholds the VPA from a non co-member", () => {
    const user = { id: "u2", displayName: "Bob", vpa: "bob@bank" };
    expect(serialiseUser(user, false)).toEqual({ id: "u2", displayName: "Bob", vpa: null });
    expect(serialiseUser(user, true).vpa).toBe("bob@bank");
  });
});

describe("account recovery", () => {
  /** A credential row, without going through WebAuthn. */
  const addCredential = (db: ReturnType<typeof createDb>, userId: string, credentialId: string) =>
    db.insertCredential({
      id: uuidv7(),
      userId,
      credentialId,
      publicKey: "pk",
      counter: 0,
      transports: null,
      backedUp: false,
      createdAt: NOW,
    });

  async function ownerAnd(db: ReturnType<typeof createDb>, memberName: string) {
    const ownerId = uuidv7();
    await db.insertUser({ id: ownerId, displayName: "Owner", isOwner: true, createdAt: NOW });
    const cookie = `${SESSION_COOKIE}=${await createSession(db, ownerId, NOW)}`;
    const member = await signIn(db, memberName);
    return { ownerId, cookie, member };
  }

  it("refuses to revoke a user's last credential, admin or self", async () => {
    const { env, db } = setup();
    const { cookie, member } = await ownerAnd(db, "Ada");
    await addCredential(db, member.id, "only-one");
    const [only] = await db.listCredentials(member.id);
    if (!only) throw new Error("fixture: expected one credential");

    const asAdmin = await del(env, `/api/admin/users/${member.id}/credentials/${only.id}`, cookie);
    expect(asAdmin.status).toBe(409);
    const asSelf = await del(env, `/api/me/devices/${only.id}`, member.cookie);
    expect(asSelf.status).toBe(409);
    // still usable - a refused revoke must not half-apply
    expect(await db.listCredentials(member.id)).toHaveLength(1);

    // with a second credential the revoke goes through
    await addCredential(db, member.id, "second");
    const ok = await del(env, `/api/admin/users/${member.id}/credentials/${only.id}`, cookie);
    expect(ok.status).toBe(200);
    expect(await db.listCredentials(member.id)).toHaveLength(1);
  });

  it("self-revoke succeeds once a second credential exists, and refuses someone else's", async () => {
    const { env, db } = setup();
    const { member } = await ownerAnd(db, "Ada");
    const other = await signIn(db, "Bob");
    await addCredential(db, member.id, "device-one");
    await addCredential(db, member.id, "device-two");
    const [first, second] = await db.listCredentials(member.id);
    if (!first || !second) throw new Error("fixture: expected two credentials");

    // Another account cannot revoke a credential that is not its own.
    const wrongOwner = await del(env, `/api/me/devices/${first.id}`, other.cookie);
    expect(wrongOwner.status).toBe(404);
    expect(await db.listCredentials(member.id)).toHaveLength(2);

    const res = await del(env, `/api/me/devices/${first.id}`, member.cookie);
    expect(res.status).toBe(200);
    const remaining = await db.listCredentials(member.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(second.id);

    // The last remaining one is still refused.
    expect((await del(env, `/api/me/devices/${second.id}`, member.cookie)).status).toBe(409);
  });

  it("a recovery token re-enrols the SAME user and never creates a second one", async () => {
    const { env, db } = setup();
    const { cookie, member } = await ownerAnd(db, "Ada");
    await addCredential(db, member.id, "lost-device");

    const minted = await post(env, `/api/admin/users/${member.id}/recovery`, {}, cookie);
    expect(minted.status).toBe(201);
    const { token } = (await minted.json()) as { token: string };

    const before = (await db.listUsers()).length;
    // no session cookie: this is the locked-out device
    const res = await post(env, "/api/auth/register/options", { displayName: "Ada", recoveryToken: token });
    expect(res.status).toBe(200);
    // the session it hands back belongs to the EXISTING account
    const session = /tally_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1];
    const who = await get(env, "/api/me", `${SESSION_COOKIE}=${session}`);
    expect(await who.json()).toMatchObject({ id: member.id, displayName: "Ada" });
    expect((await db.listUsers()).length).toBe(before); // no orphaned second account
  });

  it("a recovery token is single-use and rejects a replay", async () => {
    const { env, db } = setup();
    const { cookie, member } = await ownerAnd(db, "Ada");
    const { token } = (await (
      await post(env, `/api/admin/users/${member.id}/recovery`, {}, cookie)
    ).json()) as { token: string };

    expect((await post(env, "/api/auth/register/options", { displayName: "Ada", recoveryToken: token })).status).toBe(200);
    const replay = await post(env, "/api/auth/register/options", { displayName: "Ada", recoveryToken: token });
    expect(replay.status).toBe(403);
  });

  it("only the owner may mint a recovery token", async () => {
    const { env, db } = setup();
    const { member } = await ownerAnd(db, "Ada");
    const bob = await signIn(db, "Bob");
    expect((await post(env, `/api/admin/users/${member.id}/recovery`, {}, bob.cookie)).status).toBe(403);
    expect((await post(env, `/api/admin/users/${member.id}/recovery`, {})).status).toBe(401);
  });

  it("a forged or expired recovery token is refused", async () => {
    const { env, db } = setup();
    const { member } = await ownerAnd(db, "Ada");
    expect((await post(env, "/api/auth/register/options", { displayName: "Ada", recoveryToken: "made-up" })).status).toBe(403);

    await db.insertRecoveryToken({
      id: uuidv7(),
      tokenHash: await sha256Hex("stale"),
      userId: member.id,
      createdBy: member.id,
      createdAt: NOW - 7_200_000,
      expiresAt: NOW - 3_600_000,
    });
    expect((await post(env, "/api/auth/register/options", { displayName: "Ada", recoveryToken: "stale" })).status).toBe(403);
  });
});

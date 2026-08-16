// End-to-end for the password path: an invite becomes an account, that account
// signs in, and the session it gets is a real one. This is the flow every new
// person on the instance walks through, so it is tested against the real
// routers and the real migrated schema rather than mocked at any layer.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { req, setup, type Harness } from "./_test-harness";
import type { Env } from "~/server/context";
import auth from "~/server/routes/auth";
import me from "~/server/routes/me";
import ledgers from "~/server/routes/ledgers";
import { SESSION_COOKIE, sha256Hex } from "~/server/auth/session";
import { deriveAuthKey } from "~/shared/password-kdf";
import { uuidv7 } from "~/shared/id";

const PASSWORD = "a-long-enough-password";

/** The harness's `mount` puts every router under /api, but src/server/index.ts
 *  mounts auth one level deeper. Getting that wrong is a 404, not a failure that
 *  says anything useful, so the prefixes are spelled out here. */
function mountAuth(h: Harness) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("db", h.db);
    await next();
  });
  app.route("/api/auth", auth);
  app.route("/api", me);
  app.route("/api", ledgers);
  return app;
}

/** Writes an invite straight to the table and hands back the plaintext token -
 *  the same thing createInvite returns, without needing an owner session. */
async function seedInvite(h: Harness, ledgerId: string | null): Promise<string> {
  const token = `tok_${uuidv7()}`;
  h.sql
    .prepare(
      "INSERT INTO invites (id, token_hash, ledger_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)",
    )
    .run(uuidv7(), await sha256Hex(token), ledgerId, "u_ada", Date.now(), Date.now() + 3_600_000);
  return token;
}

/** The Set-Cookie the auth routes issue, reduced to a Cookie header. */
function sessionCookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(raw).toBeDefined();
  return raw!.split(";")[0]!;
}

describe("password signup and sign-in", () => {
  it("turns a ledger invite into an account that is a member of that ledger", async () => {
    const h = await setup();
    const app = mountAuth(h);
    const token = await seedInvite(h, "L1");

    const res = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: token, displayName: "Eve", email: "Eve@Example.com", password: PASSWORD },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { email: string; hasPassword: boolean; ledgerId: string | null };
    // Lowercased at the schema boundary - the unique index is case-sensitive.
    expect(body.email).toBe("eve@example.com");
    expect(body.hasPassword).toBe(true);
    expect(body.ledgerId).toBe("L1");

    // The invite is spent, so the same link cannot mint a second account.
    const again = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: token, displayName: "Mallory", email: "mallory@example.com", password: PASSWORD },
      }),
    );
    expect(again.status).toBe(403);
  });

  it("accepts an INSTANCE invite and joins no ledger", async () => {
    const h = await setup();
    const app = mountAuth(h);
    const token = await seedInvite(h, null);

    const res = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: token, displayName: "Eve", email: "eve@example.com", password: PASSWORD },
      }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ledgerId: string | null }).ledgerId).toBeNull();
  });

  it("refuses signup without a usable invite, and never creates the user", async () => {
    const h = await setup();
    const app = mountAuth(h);

    const res = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: "not-a-real-token", displayName: "Eve", email: "eve@example.com", password: PASSWORD },
      }),
    );
    expect(res.status).toBe(403);
    expect(await h.db.findUserByEmail("eve@example.com")).toBeUndefined();
  });

  it("signs in with the right password and rejects the wrong one identically to an unknown email", async () => {
    const h = await setup();
    const app = mountAuth(h);
    const token = await seedInvite(h, null);
    await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: token, displayName: "Eve", email: "eve@example.com", password: PASSWORD },
      }),
    );

    const good = await app.request(
      req(h, "/api/auth/signin", { method: "POST", json: { email: "EVE@example.com", password: PASSWORD } }),
    );
    expect(good.status).toBe(200);

    // The session that sign-in issued is a real one: it resolves to Eve, not to
    // Ada, whose cookie the harness attaches to every request by default.
    const cookie = sessionCookieFrom(good);
    const whoami = await app.request(
      new Request("http://tally.test/api/me", { headers: { cookie } }),
    );
    expect(((await whoami.json()) as { displayName: string }).displayName).toBe("Eve");

    const wrongPassword = await app.request(
      req(h, "/api/auth/signin", { method: "POST", json: { email: "eve@example.com", password: "wrong-password" } }),
    );
    const unknownEmail = await app.request(
      req(h, "/api/auth/signin", { method: "POST", json: { email: "nobody@example.com", password: PASSWORD } }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Same body too - the failure must not say which half was wrong.
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it("composes with the browser KDF: sign up and sign in through the real client path", async () => {
    // Every other test here posts a bare string, because to the server the
    // password is opaque. This one proves the two halves actually meet: what
    // the browser derives is what a later sign-in reproduces.
    const h = await setup();
    const app = mountAuth(h);
    const token = await seedInvite(h, null);
    const email = "eve@example.com";

    const up = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: {
          inviteToken: token,
          displayName: "Eve",
          email,
          password: await deriveAuthKey(PASSWORD, email),
        },
      }),
    );
    expect(up.status).toBe(201);

    // Typed with different capitalisation on a second device - the KDF and the
    // server normalise the address identically, so it still resolves.
    const inAgain = await app.request(
      req(h, "/api/auth/signin", {
        method: "POST",
        json: { email: "EVE@Example.com", password: await deriveAuthKey(PASSWORD, "EVE@Example.com") },
      }),
    );
    expect(inAgain.status).toBe(200);

    const wrong = await app.request(
      req(h, "/api/auth/signin", {
        method: "POST",
        json: { email, password: await deriveAuthKey("not-the-password", email) },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("refuses a second account on the same email", async () => {
    const h = await setup();
    const app = mountAuth(h);
    const first = await seedInvite(h, null);
    const second = await seedInvite(h, null);

    await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: first, displayName: "Eve", email: "eve@example.com", password: PASSWORD },
      }),
    );
    const clash = await app.request(
      req(h, "/api/auth/signup", {
        method: "POST",
        json: { inviteToken: second, displayName: "Impostor", email: "EVE@example.com", password: PASSWORD },
      }),
    );
    expect(clash.status).toBe(409);
  });

  it("lets a passkey-only account claim an email and a password, then sign in with it", async () => {
    const h = await setup();
    const app = mountAuth(h);

    // Ada is the harness's signed-in user and has no password.
    const before = await app.request(req(h, "/api/me"));
    expect(((await before.json()) as { hasPassword: boolean }).hasPassword).toBe(false);

    const set = await app.request(
      req(h, "/api/me/password", { method: "POST", json: { email: "ada@example.com", password: PASSWORD } }),
    );
    expect(set.status).toBe(200);

    const signedIn = await app.request(
      req(h, "/api/auth/signin", { method: "POST", json: { email: "ada@example.com", password: PASSWORD } }),
    );
    expect(signedIn.status).toBe(200);

    // Changing it now requires the current one - a borrowed unlocked phone must
    // not be able to lock the real owner out.
    const noCurrent = await app.request(
      req(h, "/api/me/password", { method: "POST", json: { password: "another-long-password" } }),
    );
    expect(noCurrent.status).toBe(403);

    const changed = await app.request(
      req(h, "/api/me/password", {
        method: "POST",
        json: { currentPassword: PASSWORD, password: "another-long-password" },
      }),
    );
    expect(changed.status).toBe(200);
    const stale = await app.request(
      req(h, "/api/auth/signin", { method: "POST", json: { email: "ada@example.com", password: PASSWORD } }),
    );
    expect(stale.status).toBe(401);
  });
});

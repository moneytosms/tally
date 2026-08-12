// Bootstrap, passkey registration, passkey login, logout.
//
// There is NO public signup. Registration is reachable exactly two ways:
//   - the instance is unclaimed and the caller has the bootstrap secret, or
//   - the caller holds a usable invite (which is bound to one ledger).
// A stranger with neither gets 403 and learns nothing.
//
// Never log a token, a secret or a challenge — not even while debugging.
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import type { Env } from "~/server/context";
import { uuidv7 } from "~/shared/id";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  resolveSession,
  sessionCookie,
  sha256Hex,
  timingSafeEqual,
} from "~/server/auth/session";
import {
  CHALLENGE_COOKIE,
  authenticationOptions,
  clearChallengeCookie,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "~/server/auth/webauthn";
import { requireSession } from "~/server/middleware/session";
import { meResponse } from "~/server/routes/me";

/** instance_state key recording that the bootstrap secret has been spent. */
export const BOOTSTRAP_BURNED = "bootstrap_burned";

const displayName = z.string().trim().min(1).max(80);
const bootstrapSchema = z.object({ secret: z.string().min(1), displayName });
// `response` is handed straight to SimpleWebAuthn, which validates it properly.
const registerOptionsSchema = z.object({
  displayName,
  inviteToken: z.string().min(1).nullish(),
  recoveryToken: z.string().min(1).nullish(),
});
const verifySchema = z.object({ response: z.record(z.string(), z.unknown()) });

const auth = new Hono<Env>();

const json = (c: Context<Env>): Promise<unknown> => c.req.json().catch(() => ({}));

/** Session if there is one; null otherwise. Unlike requireSession this never 401s. */
async function optionalUser(c: Context<Env>) {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? await resolveSession(c.var.db, token, Date.now()) : null;
}

// ---- bootstrap --------------------------------------------------------------

/** Claims the instance. Single-use: the secret is burned in the same batch that
 *  creates the owner, so a replay after success is indistinguishable from a
 *  wrong secret. `users_owner_uq` is the second line of defence. */
auth.post("/bootstrap", async (c) => {
  const db = c.var.db;
  const parsed = bootstrapSchema.safeParse(await json(c));
  const configured = c.env.BOOTSTRAP_SECRET ?? "";
  const burned = await db.getInstanceState(BOOTSTRAP_BURNED);

  const ok =
    parsed.success &&
    !burned &&
    configured !== "" &&
    timingSafeEqual(parsed.data.secret, configured);
  if (!ok || !parsed.success) return c.json({ error: "forbidden" }, 403);

  const now = Date.now();
  const id = uuidv7();
  await db.batch([
    db.insertUser({ id, displayName: parsed.data.displayName, isOwner: true, createdAt: now }),
    db.setInstanceState(BOOTSTRAP_BURNED, String(now), now),
  ]);

  const token = await createSession(db, id, now, c.req.header("user-agent") ?? null);
  c.header("set-cookie", sessionCookie(token), { append: true });
  const body = await meResponse(db, { id, displayName: parsed.data.displayName, isOwner: true });
  return c.json(body, 201);
});

// ---- registration -----------------------------------------------------------

/** Options for a new passkey. Either the caller already has a session (adding a
 *  device, or the owner straight after bootstrap) or they present a usable
 *  invite — nothing else creates a user. */
auth.post("/register/options", async (c) => {
  const db = c.var.db;
  const parsed = registerOptionsSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);

  const now = Date.now();
  let user = await optionalUser(c);
  if (!user && parsed.data.recoveryToken) {
    // Recovery re-enrols an EXISTING user. It must never insertUser — a second
    // account would strand the first one's expense history. The displayName in
    // the request is ignored here; the account already has one.
    const row = await db.findUsableRecoveryToken(await sha256Hex(parsed.data.recoveryToken), now);
    if (!row) return c.json({ error: "forbidden" }, 403);
    // Single-use rests on this conditional UPDATE, exactly as with invites.
    const claimed = await db.consumeRecoveryToken(row.token.id, now);
    if (claimed.meta.changes !== 1) return c.json({ error: "forbidden" }, 403);

    user = { id: row.user.id, displayName: row.user.displayName, isOwner: row.user.isOwner };
    const token = await createSession(db, user.id, now, c.req.header("user-agent") ?? null);
    c.header("set-cookie", sessionCookie(token), { append: true });
  }
  if (!user) {
    const inviteToken = parsed.data.inviteToken;
    // Every rejection reason collapses to one — an invite is a bearer credential.
    if (!inviteToken) return c.json({ error: "forbidden" }, 403);
    if (!(await db.findUsableInvite(await sha256Hex(inviteToken), now))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const id = uuidv7();
    await db.insertUser({ id, displayName: parsed.data.displayName, isOwner: false, createdAt: now });
    user = { id, displayName: parsed.data.displayName, isOwner: false };
    const token = await createSession(db, id, now, c.req.header("user-agent") ?? null);
    c.header("set-cookie", sessionCookie(token), { append: true });
  }

  const { options, cookie } = await registrationOptions(
    db,
    c.env.BOOTSTRAP_SECRET,
    { id: user.id, displayName: user.displayName },
    now,
  );
  c.header("set-cookie", cookie, { append: true });
  return c.json(options);
});

/** The challenge cookie is cleared on EVERY outcome — that is what makes the
 *  challenge single-use. */
auth.post("/register/verify", requireSession, async (c) => {
  const parsed = verifySchema.safeParse(await json(c));
  c.header("set-cookie", clearChallengeCookie(), { append: true });
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);
  try {
    await verifyRegistration(c.var.db, c.env.BOOTSTRAP_SECRET, {
      userId: c.var.user.id,
      // SimpleWebAuthn does the real validation of this payload.
      response: parsed.data.response as never,
      sealedChallenge: getCookie(c, CHALLENGE_COOKIE),
      now: Date.now(),
    });
  } catch {
    return c.json({ error: "registration failed", code: "webauthn" }, 400);
  }
  return c.json(await meResponse(c.var.db, c.var.user), 201);
});

// ---- login ------------------------------------------------------------------

auth.post("/login/options", async (c) => {
  const { options, cookie } = await authenticationOptions(c.env.BOOTSTRAP_SECRET, Date.now());
  c.header("set-cookie", cookie, { append: true });
  return c.json(options);
});

auth.post("/login/verify", async (c) => {
  const db = c.var.db;
  const parsed = verifySchema.safeParse(await json(c));
  c.header("set-cookie", clearChallengeCookie(), { append: true });
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);

  const now = Date.now();
  let userId: string;
  try {
    ({ userId } = await verifyAuthentication(db, c.env.BOOTSTRAP_SECRET, {
      // SimpleWebAuthn does the real validation of this payload.
      response: parsed.data.response as never,
      sealedChallenge: getCookie(c, CHALLENGE_COOKIE),
      now,
    }));
  } catch {
    return c.json({ error: "authentication failed", code: "webauthn" }, 401);
  }

  const row = await db.findUserById(userId);
  if (!row) return c.json({ error: "authentication failed", code: "webauthn" }, 401);
  const token = await createSession(db, userId, now, c.req.header("user-agent") ?? null);
  c.header("set-cookie", sessionCookie(token), { append: true });
  return c.json(await meResponse(db, { id: row.id, displayName: row.displayName, isOwner: row.isOwner }));
});

// ---- logout -----------------------------------------------------------------

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.var.db, token);
  c.header("set-cookie", clearSessionCookie(), { append: true });
  return c.json({ ok: true });
});

export default auth;

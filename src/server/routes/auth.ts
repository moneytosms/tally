// Bootstrap, sign-up, sign-in (password or passkey), logout.
//
// There is NO public signup. Registration is reachable exactly two ways:
//   - the instance is unclaimed and the caller has the bootstrap secret, or
//   - the caller holds a usable invite (instance-wide, or bound to one ledger).
// A stranger with neither gets 403 and learns nothing.
//
// Two credential kinds, one account: a password (email + PBKDF2) and any number
// of passkeys. Either signs you in; the account is the same row either way.
//
// Never log a token, a secret or a challenge - not even while debugging.
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
  randomToken,
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
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { acceptInvite, InviteError } from "~/server/auth/invite";
import { signInSchema, signUpSchema } from "~/shared/schemas";

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

/** Claims the instance.
 *
 *  The secret is NOT burned here. Bootstrap only creates the owner row and a
 *  session; the account is useless until a passkey is enrolled, and enrolment can
 *  fail or be abandoned. Burning at this point strands the instance: an owner with
 *  no credential, a spent secret, and nobody left who can issue an invite. The
 *  burn happens on the owner's first successful `register/verify` instead.
 *
 *  Until then this endpoint is re-runnable with the same secret and re-attaches to
 *  the SAME owner - it never creates a second one. `users_owner_uq` is the second
 *  line of defence. */
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
  const existing = await db.findOwner();
  // Not burned but an owner exists = a previous attempt stopped before enrolling.
  // Hand that same account a fresh session so the passkey step can be retried.
  const owner = existing ?? { id: uuidv7(), displayName: parsed.data.displayName, isOwner: true };
  if (!existing) {
    await db.insertUser({
      id: owner.id,
      displayName: owner.displayName,
      isOwner: true,
      accountType: "full",
      createdAt: now,
    });
  }

  const token = await createSession(db, owner.id, now, c.req.header("user-agent") ?? null);
  c.header("set-cookie", sessionCookie(token), { append: true });
  const body = await meResponse(db, { id: owner.id, displayName: owner.displayName, isOwner: true, accountType: "full" });
  return c.json(body, 201);
});

// ---- password sign-up / sign-in ---------------------------------------------

/** A hash of a value nobody knows, used to spend the same CPU on an unknown
 *  email as on a known one. Without it, response time answers "does this
 *  address have an account here?" for anyone who asks.
 *
 *  Built lazily and once per isolate: hashing at module scope would burn the
 *  PBKDF2 cost during cold start, on requests that have nothing to do with auth. */
let dummyHash: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken());
  return dummyHash;
}

/**
 * Create an account from an invite, with an email and a password.
 *
 * The invite is the only gate - there is still no open signup. An instance
 * invite admits them to tally; a ledger invite also joins that ledger. The
 * order matters: the user row must exist before the invite is consumed, or a
 * crash in between burns the invite and creates nobody.
 */
auth.post("/signup", async (c) => {
  const db = c.var.db;
  const parsed = signUpSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);
  const { inviteToken, displayName: name, email, password } = parsed.data;

  const now = Date.now();
  // Checked before the account is created so a bad invite never leaves a row
  // behind. It is consumed further down, after the user exists. The ledgerId
  // on the invite - peeked at here, not yet consumed - decides the account
  // ceiling (ADR 0008): a ledger invite makes a restricted account, an
  // instance invite makes a full one.
  const usable = await db.findUsableInvite(await sha256Hex(inviteToken), now);
  if (!usable) return c.json({ error: "forbidden", code: "invite" }, 403);
  const accountType = usable.invite.ledgerId !== null ? "restricted" : "full";
  if (await db.findUserByEmail(email)) {
    return c.json({ error: "email already registered", code: "email_taken" }, 409);
  }

  const id = uuidv7();
  try {
    await db.insertUser({
      id,
      displayName: name,
      email,
      passwordHash: await hashPassword(password),
      isOwner: false,
      accountType,
      createdAt: now,
    });
  } catch {
    // users_email_uq is the real guard against two concurrent signups on one
    // address; the check above is only there to give a nicer message.
    return c.json({ error: "email already registered", code: "email_taken" }, 409);
  }

  let ledgerId: string | null = null;
  try {
    ({ ledgerId } = await acceptInvite(db, { token: inviteToken, userId: id, now }));
  } catch (e) {
    if (!(e instanceof InviteError)) throw e;
    // Raced with another claim of the same single-use invite. The account is
    // already written, so the honest outcome is to fail the signup loudly
    // rather than hand out an account the invite did not pay for.
    await db.softDeleteUser(id, now);
    return c.json({ error: "forbidden", code: "invite" }, 403);
  }

  const token = await createSession(db, id, now, c.req.header("user-agent") ?? null);
  c.header("set-cookie", sessionCookie(token), { append: true });
  const body = await meResponse(db, { id, displayName: name, isOwner: false, accountType });
  return c.json({ ...body, ledgerId }, 201);
});

/** Email + password. Every failure is the same 401 with the same shape and
 *  roughly the same cost - "no such account" and "wrong password" must not be
 *  distinguishable. */
auth.post("/signin", async (c) => {
  const db = c.var.db;
  const parsed = signInSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);

  const row = await db.findUserByEmail(parsed.data.email);
  const ok = await verifyPassword(parsed.data.password, row?.passwordHash ?? (await dummyPasswordHash()));
  if (!row || !ok) return c.json({ error: "authentication failed", code: "credentials" }, 401);

  const now = Date.now();
  const token = await createSession(db, row.id, now, c.req.header("user-agent") ?? null);
  c.header("set-cookie", sessionCookie(token), { append: true });
  return c.json(
    await meResponse(db, { id: row.id, displayName: row.displayName, isOwner: row.isOwner, accountType: row.accountType }),
  );
});

// ---- registration -----------------------------------------------------------

/** Options for a new passkey. Either the caller already has a session (adding a
 *  device, or the owner straight after bootstrap) or they present a usable
 *  invite - nothing else creates a user. */
auth.post("/register/options", async (c) => {
  const db = c.var.db;
  const parsed = registerOptionsSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);

  const now = Date.now();
  let user = await optionalUser(c);
  if (!user && parsed.data.recoveryToken) {
    // Recovery re-enrols an EXISTING user. It must never insertUser - a second
    // account would strand the first one's expense history. The displayName in
    // the request is ignored here; the account already has one.
    const row = await db.findUsableRecoveryToken(await sha256Hex(parsed.data.recoveryToken), now);
    if (!row) return c.json({ error: "forbidden" }, 403);
    // Single-use rests on this conditional UPDATE, exactly as with invites.
    const claimed = await db.consumeRecoveryToken(row.token.id, now);
    if (claimed.meta.changes !== 1) return c.json({ error: "forbidden" }, 403);

    user = { id: row.user.id, displayName: row.user.displayName, isOwner: row.user.isOwner, accountType: row.user.accountType };
    const token = await createSession(db, user.id, now, c.req.header("user-agent") ?? null);
    c.header("set-cookie", sessionCookie(token), { append: true });
  }
  if (!user) {
    const inviteToken = parsed.data.inviteToken;
    // Every rejection reason collapses to one - an invite is a bearer credential.
    if (!inviteToken) return c.json({ error: "forbidden" }, 403);
    const usable = await db.findUsableInvite(await sha256Hex(inviteToken), now);
    if (!usable) return c.json({ error: "forbidden" }, 403);
    // Peeked at, not yet consumed - the ledger membership itself is joined later
    // via POST /invites/:token/accept. The ledgerId alone decides the account
    // ceiling (ADR 0008).
    const accountType = usable.invite.ledgerId !== null ? "restricted" : "full";
    const id = uuidv7();
    await db.insertUser({ id, displayName: parsed.data.displayName, isOwner: false, accountType, createdAt: now });
    user = { id, displayName: parsed.data.displayName, isOwner: false, accountType };
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

/** The challenge cookie is cleared on EVERY outcome - that is what makes the
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
  // The owner now has a passkey, so the claim is complete and the secret is spent.
  // Idempotent: re-running it on a later device just rewrites the same key.
  if (c.var.user.isOwner) {
    const now = Date.now();
    await c.var.db.setInstanceState(BOOTSTRAP_BURNED, String(now), now);
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
  return c.json(
    await meResponse(db, { id: row.id, displayName: row.displayName, isOwner: row.isOwner, accountType: row.accountType }),
  );
});

// ---- logout -----------------------------------------------------------------

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.var.db, token);
  c.header("set-cookie", clearSessionCookie(), { append: true });
  return c.json({ ok: true });
});

export default auth;

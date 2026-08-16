// Profile, devices, and THE user serialiser.
//
// SPEC §7: "UPI VPA is visible only to ledger co-members. Serialise profiles
// through one function taking the viewer as an argument; never spread a user
// row into a response." `serialiseUser` below is that function. Every response
// that carries a user must go through it - that is the whole control.
import { Hono } from "hono";
import type { Db } from "~/db";
import type { Env, SessionUser } from "~/server/context";
import { requireSession } from "~/server/middleware/session";
import { revokeCredential } from "~/server/auth/webauthn";
import { setPasswordSchema, updateProfileSchema } from "~/shared/schemas";
import { hashPassword, verifyPassword } from "~/server/auth/password";

export type PublicUser = { id: string; displayName: string; vpa: string | null };

/**
 * The ONE place a user becomes a response. `sharesLedgerWithViewer` is the
 * viewer-dependent argument: true only when the viewer is this user, or is a
 * current member of some ledger this user is also a current member of.
 * Anything else and the VPA is null. Never spread a user row instead of this.
 */
export function serialiseUser(
  user: { id: string; displayName: string; vpa: string | null },
  sharesLedgerWithViewer: boolean,
): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    vpa: sharesLedgerWithViewer ? (user.vpa ?? null) : null,
  };
}

/** `Me` - self, so the VPA is always visible, but still via the serialiser. */
export async function meResponse(db: Db, user: SessionUser) {
  const row = await db.findUserById(user.id);
  if (!row) return null;
  const credentials = await db.listCredentials(user.id);
  return {
    ...serialiseUser(row, true),
    isOwner: row.isOwner,
    // Own account only. The hash never leaves the server - only whether one exists,
    // which is what the You tab needs to say "set" versus "change" password.
    email: row.email ?? null,
    hasPassword: row.passwordHash !== null,
    credentials: credentials.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    })),
  };
}

const me = new Hono<Env>();

me.use("/me", requireSession);
me.use("/me/*", requireSession);

me.get("/me", async (c) => {
  const body = await meResponse(c.var.db, c.var.user);
  return body ? c.json(body) : c.json({ error: "unauthenticated" }, 401);
});

me.patch("/me", async (c) => {
  const parsed = updateProfileSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid profile", code: "invalid" }, 400);
  // Only the keys actually sent - an older client sending fewer fields must not
  // null out the rest (SPEC §10, one version of skew).
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length > 0) await c.var.db.updateUser(c.var.user.id, patch);
  const body = await meResponse(c.var.db, c.var.user);
  return body ? c.json(body) : c.json({ error: "unauthenticated" }, 401);
});

/**
 * Set or change the account password.
 *
 * Setting one for the first time also claims the sign-in address, which is why
 * `email` is accepted here and nowhere else - it is an auth operation, not a
 * profile field. Changing an existing password requires the current one: a
 * borrowed unlocked phone must not be able to lock the owner out.
 */
me.post("/me/password", async (c) => {
  const parsed = setPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid request", code: "invalid" }, 400);

  const row = await c.var.db.findUserById(c.var.user.id);
  if (!row) return c.json({ error: "unauthenticated" }, 401);

  if (row.passwordHash) {
    const ok = await verifyPassword(parsed.data.currentPassword ?? "", row.passwordHash);
    if (!ok) return c.json({ error: "wrong password", code: "credentials" }, 403);
  }

  const email = row.email ?? parsed.data.email ?? null;
  if (!email) return c.json({ error: "email required", code: "email_required" }, 400);
  if (!row.email && (await c.var.db.findUserByEmail(email))) {
    return c.json({ error: "email already registered", code: "email_taken" }, 409);
  }

  try {
    await c.var.db.updateUser(row.id, { email, passwordHash: await hashPassword(parsed.data.password) });
  } catch {
    // users_email_uq, same as signup - the check above is only for the message.
    return c.json({ error: "email already registered", code: "email_taken" }, 409);
  }
  const body = await meResponse(c.var.db, c.var.user);
  return body ? c.json(body) : c.json({ error: "unauthenticated" }, 401);
});

/** Per-device revocation. Recovery revokes, never merely adds (SPEC §7). */
me.delete("/me/devices/:credentialId", async (c) => {
  const id = c.req.param("credentialId");
  const own = await c.var.db.listCredentials(c.var.user.id);
  if (!own.some((cred) => cred.id === id)) return c.json({ error: "not found" }, 404);
  // Same guard as the admin route: revoking your only passkey locks you out of
  // your own account, and no invite can undo it. Add the replacement first.
  if (own.length === 1) return c.json({ error: "last credential", code: "last_credential" }, 409);
  await revokeCredential(c.var.db, id, Date.now());
  return c.json({ ok: true });
});

export default me;

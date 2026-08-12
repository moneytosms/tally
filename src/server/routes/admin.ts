// The owner's admin panel.
//
// Every route here is requireSession + requireOwner. The Owner is the person who
// runs the Instance (CONTEXT.md) - there is exactly one, and the role is not
// grantable through the API.
//
// Deliberately NOT here: anything that edits money. The owner has no special
// power over expenses, splits or settlements - that is what keeps the audit
// trail meaningful (ADR 0005). The panel manages people, invites and categories.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireOwner } from "~/server/middleware/owner";
import { requireSession } from "~/server/middleware/session";
import { revokeCredential } from "~/server/auth/webauthn";
import { randomToken, sha256Hex } from "~/server/auth/session";
import { uuidv7 } from "~/shared/id";
import { RP_ID } from "~/shared/rp-id";

/** Short, because the owner hands this over directly rather than mailing it. */
export const RECOVERY_TTL_MS = 3_600_000;

const admin = new Hono<Env>();
admin.use("/admin/*", requireSession, requireOwner);

/**
 * People on the instance, with passkey counts.
 *
 * VPAs are NOT included. The owner is not automatically a co-member of every
 * ledger, and SPEC §7 makes VPA visibility a co-membership question, not a
 * privilege question - so the admin panel does not get to see them either.
 */
admin.get("/admin/users", async (c) => {
  const users = await c.var.db.listUsers();
  const out = [];
  for (const u of users) {
    const credentials = await c.var.db.listCredentials(u.id);
    out.push({
      id: u.id,
      displayName: u.displayName,
      isOwner: u.isOwner,
      createdAt: u.createdAt,
      credentials: credentials.map((k) => ({ id: k.id, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    });
  }
  return c.json(out);
});

/**
 * Passkey recovery, step two: revoke the lost credential.
 *
 * Refuses to revoke a user's LAST credential. An Invite cannot undo it - the
 * invite path creates a new user, so the old account and its expense history
 * would be stranded. Issue a recovery token and let them enrol a replacement
 * first; then this revoke is safe.
 */
admin.delete("/admin/users/:userId/credentials/:credentialId", async (c) => {
  const userId = c.req.param("userId");
  const credentialId = c.req.param("credentialId");

  const credentials = await c.var.db.listCredentials(userId);
  if (!credentials.some((k) => k.id === credentialId)) return c.json({ error: "not found" }, 404);
  if (credentials.length === 1) return c.json({ error: "last credential", code: "last_credential" }, 409);

  await revokeCredential(c.var.db, credentialId, Date.now());
  return c.json({ id: credentialId });
});

/**
 * Passkey recovery, step one: a single-use token that re-enrols an EXISTING
 * user. Unlike an Invite it is bound to a userId and creates nobody, which is
 * what keeps a recovered account attached to its own history.
 *
 * The token is returned exactly once and never logged. Treat it as account
 * access and hand it over in person or over a private channel.
 */
admin.post("/admin/users/:userId/recovery", async (c) => {
  const userId = c.req.param("userId");
  if (!(await c.var.db.findUserById(userId))) return c.json({ error: "not found" }, 404);

  const now = Date.now();
  const token = randomToken();
  await c.var.db.insertRecoveryToken({
    id: uuidv7(),
    tokenHash: await sha256Hex(token),
    userId,
    createdBy: c.var.user.id,
    createdAt: now,
    expiresAt: now + RECOVERY_TTL_MS,
  });
  return c.json({ token, expiresAt: now + RECOVERY_TTL_MS }, 201);
});

admin.get("/admin/ledgers", async (c) => {
  const ledgers = await c.var.db.listAllLedgers();
  const out = [];
  for (const l of ledgers) {
    const members = await c.var.db.listMembers(l.id);
    out.push({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      archivedAt: l.archivedAt,
      memberCount: members.length,
    });
  }
  return c.json(out);
});

admin.get("/admin/invites", async (c) => {
  const rows = await c.var.db.listOpenInvites(Date.now());
  // The token itself is never returned - only its hash is stored, and an invite
  // is shown so it can be REVOKED, not so it can be re-sent.
  return c.json(
    rows.map(({ invite, ledger }) => ({
      id: invite.id,
      ledgerId: invite.ledgerId,
      ledgerName: ledger.name,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    })),
  );
});

admin.delete("/admin/invites/:inviteId", async (c) => {
  const id = c.req.param("inviteId");
  const open = (await c.var.db.listOpenInvites(Date.now())).some((r) => r.invite.id === id);
  if (!open) return c.json({ error: "not found" }, 404);
  await c.var.db.revokeInvite(id, Date.now());
  return c.json({ id });
});

/** Read-only instance facts. RP_ID is here so the frozen value is visible
 *  somewhere in the product, not only in a source file (ADR 0002). */
admin.get("/admin/instance", async (c) => {
  const users = await c.var.db.listUsers();
  const ledgers = await c.var.db.listAllLedgers();
  return c.json({
    rpId: RP_ID,
    userCount: users.length,
    ledgerCount: ledgers.length,
    pushConfigured: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
    recurringConfigured: Boolean(c.env.RECURRING),
  });
});

export default admin;

// The owner's admin panel.
//
// Every route here is requireSession + requireOwner. The Owner is the person who
// runs the Instance (CONTEXT.md) — there is exactly one, and the role is not
// grantable through the API.
//
// Deliberately NOT here: anything that edits money. The owner has no special
// power over expenses, splits or settlements — that is what keeps the audit
// trail meaningful (ADR 0005). The panel manages people, invites and categories.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireOwner } from "~/server/middleware/owner";
import { requireSession } from "~/server/middleware/session";
import { revokeCredential } from "~/server/auth/webauthn";
import { RP_ID } from "~/shared/rp-id";

const admin = new Hono<Env>();
admin.use("/admin/*", requireSession, requireOwner);

/**
 * People on the instance, with passkey counts.
 *
 * VPAs are NOT included. The owner is not automatically a co-member of every
 * ledger, and SPEC §7 makes VPA visibility a co-membership question, not a
 * privilege question — so the admin panel does not get to see them either.
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
 * Passkey recovery: revoke the lost credential (CONTEXT.md, "Credential").
 * Revoking is the whole recovery path — the user then needs a fresh Invite to
 * re-enrol, which is why an Invite is treated as potentially account access.
 */
admin.delete("/admin/users/:userId/credentials/:credentialId", async (c) => {
  const userId = c.req.param("userId");
  const credentialId = c.req.param("credentialId");

  const owned = (await c.var.db.listCredentials(userId)).some((k) => k.id === credentialId);
  if (!owned) return c.json({ error: "not found" }, 404);

  await revokeCredential(c.var.db, credentialId, Date.now());
  return c.json({ id: credentialId });
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
  // The token itself is never returned — only its hash is stored, and an invite
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

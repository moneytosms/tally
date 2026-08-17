// Ledgers, members, guests, leaving, invites.
//
// Authorisation collapses to one rule: is the caller a current member of this
// ledger? `requireMember` reads `:ledgerId` from the path, so every route below
// carries it and no handler can forget. Two exceptions, both explicit:
// deletion is creator-only, guest management is owner-only.
import { Hono } from "hono";
import type { Db } from "~/db";
import type { Env, LedgerMember } from "~/server/context";
import { netPositions } from "~/server/balances";
import { createInvite, acceptInvite, InviteError } from "~/server/auth/invite";
import { requireSession } from "~/server/middleware/session";
import { requireMember } from "~/server/middleware/membership";
import { isLedgerCreator, requireOwner } from "~/server/middleware/owner";
import { uuidv7 } from "~/shared/id";
import {
  addGuestSchema,
  addMemberSchema,
  createLedgerSchema,
  pinLedgerSchema,
  updateLedgerSchema,
} from "~/shared/schemas";

type Ledger = NonNullable<Awaited<ReturnType<Db["findLedger"]>>>;

/** Net positions of a whole ledger. Derived on every call - never stored. */
async function positionsOf(db: Db, ledgerId: string) {
  const [expenses, settlements] = await Promise.all([
    db.listExpenses(ledgerId),
    db.listSettlements(ledgerId),
  ]);
  return { positions: netPositions(expenses, settlements), expenses };
}

/** `LedgerSummary` on the wire. `net` is the VIEWER's position in this ledger. */
async function summarise(db: Db, ledger: Ledger, viewerMemberId: string) {
  const [{ positions, expenses }, members] = await Promise.all([
    positionsOf(db, ledger.id),
    db.listMembers(ledger.id),
  ]);
  return {
    id: ledger.id,
    name: ledger.name,
    endDate: ledger.endDate,
    budget: ledger.budget,
    invitesEnabled: ledger.invitesEnabled,
    color: ledger.color,
    emoji: ledger.emoji,
    // The VIEWER's own pin, read off their own member row - never another
    // member's, or one person's home screen would rearrange everyone's.
    pinned: members.find((m) => m.id === viewerMemberId)?.pinned ?? false,
    archivedAt: ledger.archivedAt,
    memberCount: members.length,
    net: positions.find((p) => p.memberId === viewerMemberId)?.net ?? 0,
    spent: expenses.reduce((sum, e) => sum + e.total, 0),
  };
}

/** `Member` on the wire. `nickname` is the label the UI renders, so it always
 *  resolves to something: explicit nickname, else guest name, else display name. */
function serialiseMember(m: LedgerMember, displayNames: Map<string, string>) {
  return {
    id: m.id,
    userId: m.userId,
    guestName: m.guestName,
    nickname: m.nickname ?? m.guestName ?? (m.userId && displayNames.get(m.userId)) ?? "",
    leftAt: m.leftAt,
  };
}

const ledgers = new Hono<Env>();

// Every ledger route is authenticated, and every one with a :ledgerId is
// membership-checked. A non-member and a non-existent ledger both get a bare 403.
ledgers.use("*", requireSession);
ledgers.use("/ledgers/:ledgerId", requireMember);
ledgers.use("/ledgers/:ledgerId/*", requireMember);

// ---- ledgers ----------------------------------------------------------------

ledgers.get("/ledgers", async (c) => {
  const rows = await c.var.db.listLedgersForUser(c.var.user.id);
  // ponytail: one pass per ledger. ~20 users, a handful of ledgers each - well
  // inside the 10 ms CPU budget. Denormalise only if that stops being true.
  return c.json(await Promise.all(rows.map((r) => summarise(c.var.db, r.ledger, r.memberId))));
});

ledgers.post("/ledgers", async (c) => {
  const parsed = createLedgerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid ledger", code: "invalid" }, 400);

  const db = c.var.db;
  const now = Date.now();
  const { cloneFrom, invitesEnabled, ...fields } = parsed.data;
  // Omitted means off - the column default and the create default must agree, or
  // a ledger's invite path would depend on which client created it.
  const ledger = {
    ...fields,
    invitesEnabled: invitesEnabled ?? false,
    id: uuidv7(),
    createdBy: c.var.user.id,
    createdAt: now,
  };
  const memberId = uuidv7();

  // Clone members: only from a ledger the caller is currently in, otherwise it
  // reads any ledger's roster. Current members only - someone who left is not
  // carried into a new trip. The caller's own row is inserted below either way.
  let cloned: ReturnType<Db["insertMember"]>[] = [];
  if (cloneFrom !== null) {
    const source = await db.listMembers(cloneFrom);
    if (!source.some((m) => m.userId === c.var.user.id && m.leftAt === null)) {
      return c.json({ error: "forbidden", code: "not_member" }, 403);
    }
    cloned = source
      .filter((m) => m.leftAt === null && m.userId !== c.var.user.id)
      .map((m) =>
        db.insertMember({
          id: uuidv7(),
          ledgerId: ledger.id,
          userId: m.userId,
          // Guests are data: a cloned guest is a new guest row, never a principal.
          guestName: m.guestName,
          nickname: m.nickname,
          joinedAt: now,
        }),
      );
  }

  // D1 has no cross-request transaction: a ledger without its creator as a
  // member would be unreachable, so all the rows go in one batch.
  await db.batch([
    db.insertLedger(ledger),
    db.insertMember({ id: memberId, ledgerId: ledger.id, userId: c.var.user.id, joinedAt: now }),
    ...cloned,
  ]);
  const row = await db.findLedger(ledger.id);
  return c.json(await summarise(db, row!, memberId), 201);
});

ledgers.get("/ledgers/:ledgerId", async (c) => {
  const ledger = await c.var.db.findLedger(c.req.param("ledgerId"));
  if (!ledger) return c.json({ error: "forbidden" }, 403);
  return c.json(await summarise(c.var.db, ledger, c.var.member.id));
});

ledgers.patch("/ledgers/:ledgerId", async (c) => {
  const parsed = updateLedgerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid ledger", code: "invalid" }, 400);
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  if (Object.keys(patch).length > 0) await db.updateLedger(ledgerId, patch);
  const ledger = await db.findLedger(ledgerId);
  if (!ledger) return c.json({ error: "forbidden" }, 403);
  return c.json(await summarise(db, ledger, c.var.member.id));
});

/** The creator's one special power. Soft-delete - nothing is ever removed. */
ledgers.delete("/ledgers/:ledgerId", async (c) => {
  const ledger = await c.var.db.findLedger(c.req.param("ledgerId"));
  if (!ledger) return c.json({ error: "forbidden" }, 403);
  if (!isLedgerCreator(ledger, c.var.user)) return c.json({ error: "forbidden", code: "not_creator" }, 403);
  await c.var.db.softDeleteLedger(ledger.id, Date.now());
  return c.json({ ok: true });
});

/** Archive requires ALL net positions at zero (SPEC §4, §12). */
ledgers.post("/ledgers/:ledgerId/archive", async (c) => {
  const ledgerId = c.req.param("ledgerId");
  const { positions } = await positionsOf(c.var.db, ledgerId);
  if (positions.some((p) => p.net !== 0)) {
    return c.json({ error: "ledger is not settled", code: "not_settled" }, 409);
  }
  await c.var.db.updateLedger(ledgerId, { archivedAt: Date.now() });
  const ledger = await c.var.db.findLedger(ledgerId);
  return c.json(await summarise(c.var.db, ledger!, c.var.member.id));
});

/** Any member may reopen. */
ledgers.post("/ledgers/:ledgerId/reopen", async (c) => {
  const ledgerId = c.req.param("ledgerId");
  await c.var.db.updateLedger(ledgerId, { archivedAt: null });
  const ledger = await c.var.db.findLedger(ledgerId);
  if (!ledger) return c.json({ error: "forbidden" }, 403);
  return c.json(await summarise(c.var.db, ledger, c.var.member.id));
});

/** Pin/unpin on the caller's own membership row (issue #26) - never another
 *  member's, so one person's home-screen order can't rearrange anyone else's. */
ledgers.post("/ledgers/:ledgerId/pin", async (c) => {
  const parsed = pinLedgerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid pin", code: "invalid" }, 400);
  const db = c.var.db;
  await db.updateMember(c.var.member.id, { pinned: parsed.data.pinned });
  const ledger = await db.findLedger(c.req.param("ledgerId"));
  return c.json(await summarise(db, ledger!, c.var.member.id));
});

// ---- members ----------------------------------------------------------------

ledgers.get("/ledgers/:ledgerId/members", async (c) => {
  const [members, users] = await Promise.all([
    c.var.db.listMembers(c.req.param("ledgerId")),
    c.var.db.listUsers(),
  ]);
  const displayNames = new Map(users.map((u) => [u.id, u.displayName]));
  return c.json(members.map((m) => serialiseMember(m, displayNames)));
});

/**
 * Every live user who is NOT already a current member - the candidate list for
 * the route below.
 *
 * Deliberately NOT `serialiseUser`: these people are by definition not
 * co-members of this ledger, so their VPA must not cross the wire (SPEC §7).
 * Only id and display name, which is all a picker needs.
 */
ledgers.get("/ledgers/:ledgerId/addable-users", async (c) => {
  const [users, members] = await Promise.all([
    c.var.db.listUsers(),
    c.var.db.listMembers(c.req.param("ledgerId")),
  ]);
  const already = new Set(members.map((m) => m.userId));
  return c.json(
    users.filter((u) => !already.has(u.id)).map((u) => ({ id: u.id, displayName: u.displayName })),
  );
});

/**
 * Add an EXISTING user straight to the ledger - an invite without the round
 * trip. Any member may, exactly as any member may mint an invite (ADR 0005).
 *
 * Only ever a real user id: guests are data, and the guest route is the one
 * place a guest row is born.
 */
ledgers.post("/ledgers/:ledgerId/members", async (c) => {
  const parsed = addMemberSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid member", code: "invalid" }, 400);

  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  const user = await db.findUserById(parsed.data.userId);
  if (!user) return c.json({ error: "no such user", code: "no_user" }, 404);

  // listMembers is current-members-only, so someone who LEFT falls through to
  // insertMember's upsert and becomes current again - which is the point.
  if ((await db.listMembers(ledgerId)).some((m) => m.userId === user.id)) {
    return c.json({ error: "already a member", code: "already_member" }, 409);
  }

  await db.insertMember({ id: uuidv7(), ledgerId, userId: user.id, joinedAt: Date.now() });
  // Read back rather than echo: on the re-join path the upsert keeps the OLD
  // member row, and expenses reference member ids, so the id above is not it.
  const saved = (await db.listMembers(ledgerId)).find((m) => m.userId === user.id)!;
  return c.json(serialiseMember(saved, new Map([[user.id, user.displayName]])), 201);
});

/** Guests are DATA, never principals: a guest row has no user id, no credential
 *  and no session, and nothing here issues one. Owner-managed (SPEC §4). */
ledgers.post("/ledgers/:ledgerId/guests", requireOwner, async (c) => {
  const parsed = addGuestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid guest", code: "invalid" }, 400);
  const member = {
    id: uuidv7(),
    ledgerId: c.req.param("ledgerId"),
    userId: null,
    guestName: parsed.data.guestName,
    nickname: null,
    joinedAt: Date.now(),
    leftAt: null,
    deletedAt: null,
    pinned: false,
  };
  await c.var.db.insertMember(member);
  return c.json(serialiseMember(member, new Map()), 201);
});

/** Blocked while the member's net position is non-zero. Settle, or have someone
 *  forgive it explicitly - never a silent write-off (SPEC §4). */
ledgers.post("/ledgers/:ledgerId/leave", async (c) => {
  const { positions } = await positionsOf(c.var.db, c.req.param("ledgerId"));
  const net = positions.find((p) => p.memberId === c.var.member.id)?.net ?? 0;
  if (net !== 0) return c.json({ error: "net position is not zero", code: "non_zero_position" }, 409);
  await c.var.db.updateMember(c.var.member.id, { leftAt: Date.now() });
  return c.json({ ok: true });
});

/** Owner removes someone else - for a member who has gone inactive or left the
 *  group outside the app. Same zero-balance guard as self-leave (SPEC §4): the
 *  owner cannot write off a balance by removing the member who holds it. */
ledgers.delete("/ledgers/:ledgerId/members/:memberId", requireOwner, async (c) => {
  const ledgerId = c.req.param("ledgerId");
  const memberId = c.req.param("memberId");

  const member = (await c.var.db.listMembers(ledgerId)).find((m) => m.id === memberId);
  if (!member) return c.json({ error: "no such member", code: "no_member" }, 404);

  const { positions } = await positionsOf(c.var.db, ledgerId);
  const net = positions.find((p) => p.memberId === memberId)?.net ?? 0;
  if (net !== 0) return c.json({ error: "net position is not zero", code: "non_zero_position" }, 409);

  await c.var.db.updateMember(memberId, { leftAt: Date.now() });
  return c.json({ ok: true });
});

// ---- invites ----------------------------------------------------------------

/** Any member may invite, but only on an invite-enabled ledger (ADR 0007). The
 *  token is returned exactly once - never logged. */
ledgers.post("/ledgers/:ledgerId/invites", async (c) => {
  const ledger = await c.var.db.findLedger(c.req.param("ledgerId"));
  if (!ledger) return c.json({ error: "forbidden" }, 403);
  if (!ledger.invitesEnabled) {
    return c.json({ error: "invites are disabled on this ledger", code: "invites_disabled" }, 409);
  }

  const now = Date.now();
  const token = await createInvite(c.var.db, {
    ledgerId: c.req.param("ledgerId"),
    createdBy: c.var.user.id,
    now,
  });
  return c.json({ token, expiresAt: now + 48 * 3_600_000 }, 201);
});

ledgers.delete("/ledgers/:ledgerId/invites/:inviteId", async (c) => {
  await c.var.db.revokeInvite(c.req.param("inviteId"), Date.now());
  return c.json({ ok: true });
});

/** The one ledger route with no :ledgerId - the invite itself carries the
 *  ledger binding, so requireSession is the correct and only guard. */
ledgers.post("/invites/:token/accept", async (c) => {
  try {
    const { ledgerId } = await acceptInvite(c.var.db, {
      token: c.req.param("token"),
      userId: c.var.user.id,
      now: Date.now(),
    });
    return c.json({ ledgerId }, 201);
  } catch (e) {
    if (e instanceof InviteError) return c.json({ error: "invite is not usable", code: "invite" }, 400);
    throw e;
  }
});

export default ledgers;

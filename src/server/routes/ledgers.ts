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
import { addGuestSchema, createLedgerSchema, updateLedgerSchema } from "~/shared/schemas";

type Ledger = NonNullable<Awaited<ReturnType<Db["findLedger"]>>>;

/** Net positions of a whole ledger. Derived on every call — never stored. */
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
  // ponytail: one pass per ledger. ~20 users, a handful of ledgers each — well
  // inside the 10 ms CPU budget. Denormalise only if that stops being true.
  return c.json(await Promise.all(rows.map((r) => summarise(c.var.db, r.ledger, r.memberId))));
});

ledgers.post("/ledgers", async (c) => {
  const parsed = createLedgerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid ledger", code: "invalid" }, 400);

  const db = c.var.db;
  const now = Date.now();
  const ledger = { ...parsed.data, id: uuidv7(), createdBy: c.var.user.id, createdAt: now };
  const memberId = uuidv7();
  // D1 has no cross-request transaction: a ledger without its creator as a
  // member would be unreachable, so both rows go in one batch.
  await db.batch([
    db.insertLedger(ledger),
    db.insertMember({ id: memberId, ledgerId: ledger.id, userId: c.var.user.id, joinedAt: now }),
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

/** The creator's one special power. Soft-delete — nothing is ever removed. */
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

// ---- members ----------------------------------------------------------------

ledgers.get("/ledgers/:ledgerId/members", async (c) => {
  const [members, users] = await Promise.all([
    c.var.db.listMembers(c.req.param("ledgerId")),
    c.var.db.listUsers(),
  ]);
  const displayNames = new Map(users.map((u) => [u.id, u.displayName]));
  return c.json(members.map((m) => serialiseMember(m, displayNames)));
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
  };
  await c.var.db.insertMember(member);
  return c.json(serialiseMember(member, new Map()), 201);
});

/** Blocked while the member's net position is non-zero. Settle, or have someone
 *  forgive it explicitly — never a silent write-off (SPEC §4). */
ledgers.post("/ledgers/:ledgerId/leave", async (c) => {
  const { positions } = await positionsOf(c.var.db, c.req.param("ledgerId"));
  const net = positions.find((p) => p.memberId === c.var.member.id)?.net ?? 0;
  if (net !== 0) return c.json({ error: "net position is not zero", code: "non_zero_position" }, 409);
  await c.var.db.updateMember(c.var.member.id, { leftAt: Date.now() });
  return c.json({ ok: true });
});

// ---- invites ----------------------------------------------------------------

/** Any member may invite. The token is returned exactly once — never logged. */
ledgers.post("/ledgers/:ledgerId/invites", async (c) => {
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

/** The one ledger route with no :ledgerId — the invite itself carries the
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

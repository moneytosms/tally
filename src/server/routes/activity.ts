// The activity feed.
//
// DERIVED, not stored. There is no activity table, because every row one would
// hold already exists somewhere else: an expense knows when it was created, a
// revision knows who edited what, a settlement knows who paid whom, a comment
// knows who said something, and a member row knows when someone joined or left.
// A separate log would be a second source of truth that can disagree with the
// first - and when it disagreed, the log is the one people would believe.
//
// The cost is that this endpoint reads several tables and merges in memory. At
// ~20 users and one ledger's worth of rows that is nowhere near the 10 ms CPU
// ceiling. If it ever is, the fix is pagination by timestamp, not a log table.
import { Hono } from "hono";
import type { Db } from "~/db";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";

const PATH = "/ledgers/:ledgerId/activity";

const activity = new Hono<Env>();
activity.use(PATH, requireSession, requireMember);
// The cross-ledger feed carries no :ledgerId: it reads only the ledgers the
// caller is a member of, so the session is the whole authorisation.
activity.use("/activity", requireSession);

export type ActivityKind = "added" | "edited" | "deleted" | "settled" | "forgave" | "commented" | "joined" | "left";

/**
 * One event. `kind` maps to a locale key under `activity.*`; the client does the
 * phrasing, so no user-facing English is assembled here.
 *
 * `amount` is integer paise, or null on events that are not about money.
 */
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  at: number;
  actorName: string | null;
  description: string | null;
  amount: number | null;
  fromName: string | null;
  toName: string | null;
  expenseId: string | null;
  /** Only on the cross-ledger feed, where "which ledger" is not implied. */
  ledgerId?: string;
  ledgerName?: string;
};

const DEFAULT_LIMIT = 100;

/** Every event of one ledger, newest first. Shared by the per-ledger feed and
 *  the cross-ledger home feed, so both phrase the same history the same way. */
async function buildEvents(db: Db, ledgerId: string): Promise<ActivityEvent[]> {
  const [expenses, revisions, settlements, comments, members, users] = await Promise.all([
    db.listExpensesForActivity(ledgerId),
    db.listRevisionsForActivity(ledgerId),
    db.listSettlements(ledgerId),
    db.listLedgerComments(ledgerId),
    db.listMembersForActivity(ledgerId),
    db.listUsers(),
  ]);

  // Two name lookups: members carry the per-ledger nickname, users carry the
  // display name. Revisions and comments reference a USER; expenses and
  // settlements reference a MEMBER - a guest has no user, which is exactly why
  // these are not the same map.
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  // Same resolution order the ledgers route uses for `nickname`: explicit nickname,
  // else guest name, else the account's display name. Dropping that last fallback is
  // what turned every user-backed member into "Unknown member".
  const nameOfMember = (m: (typeof members)[number]) =>
    m.nickname ?? m.guestName ?? (m.userId ? (userName.get(m.userId) ?? null) : null);
  const memberName = new Map(members.map((m) => [m.id, nameOfMember(m)]));

  const events: ActivityEvent[] = [];

  for (const e of expenses) {
    events.push({
      id: `expense-added-${e.id}`,
      kind: "added",
      at: e.createdAt,
      actorName: userName.get(e.createdBy) ?? null,
      description: e.description,
      amount: e.total,
      // Who added it and who paid for it are different questions, and the feed
      // answered only the first - "Sam added Cab" reads as "Sam paid".
      fromName: memberName.get(e.payerMemberId) ?? null,
      toName: null,
      expenseId: e.id,
    });
    if (e.deletedAt !== null) {
      // Who deleted it is not on the expense row, but a revision is always
      // written on delete - so the newest revision at or after deletedAt is the
      // deleter. If that lookup fails, show the event without an actor rather
      // than dropping it: the deletion happened either way.
      const by = revisions.find((r) => r.revision.expenseId === e.id && r.revision.revisedAt >= e.deletedAt!);
      events.push({
        id: `expense-deleted-${e.id}`,
        kind: "deleted",
        at: e.deletedAt,
        actorName: by ? (userName.get(by.revision.revisedBy) ?? null) : null,
        description: e.description,
        amount: e.total,
        fromName: null,
        toName: null,
        expenseId: e.id,
      });
    }
  }

  const deletedAtOf = new Map(expenses.filter((e) => e.deletedAt !== null).map((e) => [e.id, e.deletedAt!]));
  for (const { revision, description } of revisions) {
    // A revision written as part of a delete is already reported as "deleted".
    // Reporting it again as "edited" would double-count the same action.
    if (deletedAtOf.get(revision.expenseId) === revision.revisedAt) continue;
    events.push({
      id: `revision-${revision.id}`,
      kind: "edited",
      at: revision.revisedAt,
      actorName: userName.get(revision.revisedBy) ?? null,
      description,
      amount: null,
      fromName: null,
      toName: null,
      expenseId: revision.expenseId,
    });
  }

  for (const s of settlements) {
    events.push({
      id: `settlement-${s.id}`,
      // `forgiven` is arithmetically identical to a payment but socially is not.
      // It is how someone with a non-zero position becomes able to leave, and
      // the feed says so rather than calling it a payment.
      kind: s.method === "forgiven" ? "forgave" : "settled",
      at: s.declaredAt,
      actorName: null,
      description: null,
      amount: s.amount,
      fromName: memberName.get(s.fromMemberId) ?? null,
      toName: memberName.get(s.toMemberId) ?? null,
      expenseId: null,
    });
  }

  for (const { comment, author } of comments) {
    const on = expenses.find((e) => e.id === comment.expenseId);
    events.push({
      id: `comment-${comment.id}`,
      kind: "commented",
      at: comment.createdAt,
      actorName: author.displayName,
      description: on?.description ?? null,
      amount: null,
      fromName: null,
      toName: null,
      expenseId: comment.expenseId,
    });
  }

  for (const m of members) {
    events.push({
      id: `member-joined-${m.id}`,
      kind: "joined",
      at: m.joinedAt,
      actorName: nameOfMember(m),
      description: null,
      amount: null,
      fromName: null,
      toName: null,
      expenseId: null,
    });
    if (m.leftAt !== null) {
      events.push({
        id: `member-left-${m.id}`,
        kind: "left",
        at: m.leftAt,
        actorName: nameOfMember(m),
        description: null,
        amount: null,
        fromName: null,
        toName: null,
        expenseId: null,
      });
    }
  }

  // Newest first. `id` breaks ties so the order is total and stable - two events
  // in the same millisecond must not swap places between two requests.
  events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return events;
}

activity.get(PATH, async (c) => {
  const limitParam = c.req.query("limit");
  const limit = limitParam === undefined ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return c.json({ error: "limit must be an integer between 1 and 500" }, 400);
  }
  const events = await buildEvents(c.var.db, c.req.param("ledgerId"));
  return c.json(events.slice(0, limit));
});

/** The home feed: what happened lately across the ledgers the caller is in.
 *  ponytail: fans out over the caller's newest few ledgers rather than adding a
 *  cross-ledger query. Bounded by HOME_LEDGERS, so the work per request has a
 *  ceiling no matter how many ledgers someone accumulates. */
const HOME_LEDGERS = 5;
const HOME_LIMIT = 12;

activity.get("/activity", async (c) => {
  const db = c.var.db;
  const rows = await db.listLedgersForUser(c.var.user.id);
  const recent = rows
    .filter((r) => r.ledger.archivedAt === null)
    .sort((a, b) => b.ledger.createdAt - a.ledger.createdAt)
    .slice(0, HOME_LEDGERS);

  const perLedger = await Promise.all(
    recent.map(async (r) =>
      // The feed says which ledger each event belongs to - without it the same
      // sentence from two trips is indistinguishable.
      (await buildEvents(db, r.ledger.id))
        .slice(0, HOME_LIMIT)
        .map((e) => ({ ...e, ledgerId: r.ledger.id, ledgerName: r.ledger.name })),
    ),
  );

  const events = perLedger.flat().sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return c.json(events.slice(0, HOME_LIMIT));
});

export default activity;

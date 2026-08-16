/// <reference types="@cloudflare/workers-types" />
// Data-access layer.
//
// IMPORTANT: soft-delete filtering is enforced HERE, structurally.
// Never leave `deleted_at IS NULL` to individual callers - forgetting once
// produces wrong money. See docs/adr/0004 and SPEC §11 hazard 1.
//
// The drizzle instance is deliberately NOT exported. Reads are only reachable
// through the named helpers below, each of which already excludes deleted rows
// (and left members, where "current member" is what is meant).
//
// Writes return the drizzle statement instead of running it. A statement is
// awaitable, so `await db.insertExpense(...)` executes it; it is also a valid
// batch item, so `db.batch([...])` runs several atomically. D1 has no
// cross-request transaction - batch is what keeps the 1:1 ledger auto-create
// and bulk settle from half-applying (SPEC §11 hazard 2).
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql as raw } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as t from "~/db/schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export function createDb(d1: D1Database) {
  const db = drizzle(d1);

  const liveMember = (ledgerId: string) =>
    and(eq(t.ledgerMembers.ledgerId, ledgerId), isNull(t.ledgerMembers.leftAt), isNull(t.ledgerMembers.deletedAt));

  return {
    /** Run several statements atomically. D1 has no cross-request transaction. */
    batch: <U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(stmts: T) => db.batch(stmts),

    // ---- users -----------------------------------------------------------
    async findUserById(id: string) {
      const [row] = await db.select().from(t.users).where(and(eq(t.users.id, id), isNull(t.users.deletedAt))).limit(1);
      return row;
    },
    async listUsers() {
      return db.select().from(t.users).where(isNull(t.users.deletedAt));
    },
    async findOwner() {
      const [row] = await db
        .select()
        .from(t.users)
        .where(and(eq(t.users.isOwner, true), isNull(t.users.deletedAt)))
        .limit(1);
      return row;
    },
    /** Email is stored lowercased; callers must lowercase before looking up. */
    async findUserByEmail(email: string) {
      const [row] = await db
        .select()
        .from(t.users)
        .where(and(eq(t.users.email, email), isNull(t.users.deletedAt)))
        .limit(1);
      return row;
    },
    insertUser: (v: Insert<typeof t.users>) => db.insert(t.users).values(v),
    updateUser: (id: string, v: Partial<Insert<typeof t.users>>) =>
      db.update(t.users).set(v).where(and(eq(t.users.id, id), isNull(t.users.deletedAt))),
    /** Soft-delete. The email is released so the address can be re-invited; the
     *  display name stays, because every expense they touched still names them. */
    softDeleteUser: (id: string, at: number) =>
      db
        .update(t.users)
        .set({ deletedAt: at, email: null, passwordHash: null })
        .where(and(eq(t.users.id, id), isNull(t.users.deletedAt))),
    /** Every membership they hold becomes "left". Their splits are untouched -
     *  balances are derived from splits, not from membership. */
    markUserLeftEverywhere: (userId: string, at: number) =>
      db
        .update(t.ledgerMembers)
        .set({ leftAt: at })
        .where(and(eq(t.ledgerMembers.userId, userId), isNull(t.ledgerMembers.leftAt))),

    // ---- credentials -----------------------------------------------------
    async findCredential(credentialId: string) {
      const [row] = await db
        .select()
        .from(t.credentials)
        .where(and(eq(t.credentials.credentialId, credentialId), isNull(t.credentials.revokedAt)))
        .limit(1);
      return row;
    },
    async listCredentials(userId: string) {
      return db
        .select()
        .from(t.credentials)
        .where(and(eq(t.credentials.userId, userId), isNull(t.credentials.revokedAt)));
    },
    insertCredential: (v: Insert<typeof t.credentials>) => db.insert(t.credentials).values(v),
    touchCredential: (id: string, counter: number, at: number) =>
      db.update(t.credentials).set({ counter, lastUsedAt: at }).where(eq(t.credentials.id, id)),
    revokeCredential: (id: string, at: number) =>
      db.update(t.credentials).set({ revokedAt: at }).where(eq(t.credentials.id, id)),

    // ---- sessions --------------------------------------------------------
    /** Unexpired session + its live user, or undefined. */
    async findSessionByTokenHash(tokenHash: string, now: number) {
      const [row] = await db
        .select({ session: t.sessions, user: t.users })
        .from(t.sessions)
        .innerJoin(t.users, eq(t.users.id, t.sessions.userId))
        .where(and(eq(t.sessions.tokenHash, tokenHash), gt(t.sessions.expiresAt, now), isNull(t.users.deletedAt)))
        .limit(1);
      return row;
    },
    insertSession: (v: Insert<typeof t.sessions>) => db.insert(t.sessions).values(v),
    /** Sliding window: expiresAt moves with lastSeenAt, or the session never actually slides. */
    touchSession: (id: string, at: number, expiresAt: number) =>
      db.update(t.sessions).set({ lastSeenAt: at, expiresAt }).where(eq(t.sessions.id, id)),
    deleteSessionByTokenHash: (tokenHash: string) => db.delete(t.sessions).where(eq(t.sessions.tokenHash, tokenHash)),
    /** Signs a user out everywhere. Used when the owner deletes an account -
     *  a soft-deleted user still holds live session rows otherwise. */
    deleteSessionsForUser: (userId: string) => db.delete(t.sessions).where(eq(t.sessions.userId, userId)),

    // ---- ledgers ---------------------------------------------------------
    /** Every live ledger the user is a current member of. */
    async listLedgersForUser(userId: string) {
      return db
        .select({ ledger: t.ledgers, memberId: t.ledgerMembers.id })
        .from(t.ledgers)
        .innerJoin(t.ledgerMembers, eq(t.ledgerMembers.ledgerId, t.ledgers.id))
        .where(
          and(
            eq(t.ledgerMembers.userId, userId),
            isNull(t.ledgerMembers.leftAt),
            isNull(t.ledgerMembers.deletedAt),
            isNull(t.ledgers.deletedAt),
          ),
        )
        .orderBy(desc(t.ledgers.createdAt));
    },
    async findLedger(ledgerId: string) {
      const [row] = await db
        .select()
        .from(t.ledgers)
        .where(and(eq(t.ledgers.id, ledgerId), isNull(t.ledgers.deletedAt)))
        .limit(1);
      return row;
    },
    insertLedger: (v: Insert<typeof t.ledgers>) => db.insert(t.ledgers).values(v),
    updateLedger: (ledgerId: string, v: Partial<Insert<typeof t.ledgers>>) =>
      db.update(t.ledgers).set(v).where(and(eq(t.ledgers.id, ledgerId), isNull(t.ledgers.deletedAt))),
    softDeleteLedger: (ledgerId: string, at: number) =>
      db.update(t.ledgers).set({ deletedAt: at }).where(and(eq(t.ledgers.id, ledgerId), isNull(t.ledgers.deletedAt))),

    // ---- members ---------------------------------------------------------
    /** Current members only: not left, not deleted. */
    async listMembers(ledgerId: string) {
      return db.select().from(t.ledgerMembers).where(liveMember(ledgerId)).orderBy(t.ledgerMembers.joinedAt);
    },
    async findMember(ledgerId: string, userId: string) {
      const [row] = await db
        .select()
        .from(t.ledgerMembers)
        .where(and(liveMember(ledgerId), eq(t.ledgerMembers.userId, userId)))
        .limit(1);
      return row;
    },
    /**
     * Upsert on (ledgerId, userId): a member who left and is re-invited becomes current
     * again rather than colliding with the unique index. Guest rows have a null userId
     * and so never hit the conflict target.
     */
    insertMember: (v: Insert<typeof t.ledgerMembers>) =>
      db
        .insert(t.ledgerMembers)
        .values(v)
        .onConflictDoUpdate({
          target: [t.ledgerMembers.ledgerId, t.ledgerMembers.userId],
          set: { leftAt: null, deletedAt: null, joinedAt: v.joinedAt },
        }),
    updateMember: (memberId: string, v: Partial<Insert<typeof t.ledgerMembers>>) =>
      db.update(t.ledgerMembers).set(v).where(and(eq(t.ledgerMembers.id, memberId), isNull(t.ledgerMembers.deletedAt))),

    // ---- invites ---------------------------------------------------------
    /** Unconsumed, unrevoked, unexpired. A ledger invite additionally needs its
     *  ledger to be live; an instance invite (ledgerId null) has no ledger to
     *  check, which is why this is a LEFT join and not an inner one. */
    async findUsableInvite(tokenHash: string, now: number) {
      const [row] = await db
        .select({ invite: t.invites, ledger: t.ledgers })
        .from(t.invites)
        .leftJoin(t.ledgers, eq(t.ledgers.id, t.invites.ledgerId))
        .where(
          and(
            eq(t.invites.tokenHash, tokenHash),
            isNull(t.invites.consumedAt),
            isNull(t.invites.revokedAt),
            gt(t.invites.expiresAt, now),
            or(isNull(t.invites.ledgerId), isNull(t.ledgers.deletedAt)),
          ),
        )
        .limit(1);
      return row;
    },
    /** Every live ledger on the instance. Owner-only - the admin panel is the
     *  single caller, and membership is deliberately not consulted. */
    async listAllLedgers() {
      return db
        .select()
        .from(t.ledgers)
        .where(isNull(t.ledgers.deletedAt))
        .orderBy(desc(t.ledgers.createdAt));
    },
    /** Invites that could still be redeemed right now. A leaked invite is
     *  potentially account access (CONTEXT.md), so the owner can see and revoke
     *  every one that is still live. */
    async listOpenInvites(now: number) {
      return db
        .select({ invite: t.invites, ledger: t.ledgers })
        .from(t.invites)
        .leftJoin(t.ledgers, eq(t.ledgers.id, t.invites.ledgerId))
        .where(
          and(
            isNull(t.invites.consumedAt),
            isNull(t.invites.revokedAt),
            gt(t.invites.expiresAt, now),
            or(isNull(t.invites.ledgerId), isNull(t.ledgers.deletedAt)),
          ),
        )
        .orderBy(desc(t.invites.createdAt));
    },
    insertInvite: (v: Insert<typeof t.invites>) => db.insert(t.invites).values(v),
    /** Single-use: the WHERE clause is the guard against a double-accept race. */
    consumeInvite: (id: string, userId: string, at: number) =>
      db
        .update(t.invites)
        .set({ consumedAt: at, consumedBy: userId })
        .where(and(eq(t.invites.id, id), isNull(t.invites.consumedAt))),
    revokeInvite: (id: string, at: number) =>
      db.update(t.invites).set({ revokedAt: at }).where(and(eq(t.invites.id, id), isNull(t.invites.revokedAt))),

    // ---- recovery tokens -------------------------------------------------
    insertRecoveryToken: (v: Insert<typeof t.recoveryTokens>) => db.insert(t.recoveryTokens).values(v),
    /** Unconsumed, unrevoked, unexpired, and pointing at a live user. Undefined
     *  otherwise - every rejection reason collapses to one, as with invites. */
    async findUsableRecoveryToken(tokenHash: string, now: number) {
      const [row] = await db
        .select({ token: t.recoveryTokens, user: t.users })
        .from(t.recoveryTokens)
        .innerJoin(t.users, eq(t.users.id, t.recoveryTokens.userId))
        .where(
          and(
            eq(t.recoveryTokens.tokenHash, tokenHash),
            isNull(t.recoveryTokens.consumedAt),
            isNull(t.recoveryTokens.revokedAt),
            gt(t.recoveryTokens.expiresAt, now),
            isNull(t.users.deletedAt),
          ),
        )
        .limit(1);
      return row;
    },
    /** Single-use: the WHERE clause is the guard against a double-claim race. */
    consumeRecoveryToken: (id: string, at: number) =>
      db
        .update(t.recoveryTokens)
        .set({ consumedAt: at })
        .where(and(eq(t.recoveryTokens.id, id), isNull(t.recoveryTokens.consumedAt))),

    // ---- expenses --------------------------------------------------------
    /** Live expenses of a ledger, each with its splits. */
    async listExpenses(ledgerId: string) {
      const rows = await db
        .select()
        .from(t.expenses)
        .where(and(eq(t.expenses.ledgerId, ledgerId), isNull(t.expenses.deletedAt)))
        .orderBy(desc(t.expenses.paidAt));
      return withSplits(rows);
    },
    async findExpense(ledgerId: string, expenseId: string) {
      const rows = await db
        .select()
        .from(t.expenses)
        .where(and(eq(t.expenses.id, expenseId), eq(t.expenses.ledgerId, ledgerId), isNull(t.expenses.deletedAt)))
        .limit(1);
      const [row] = await withSplits(rows);
      return row;
    },
    /**
     * Search and filter within one ledger. Every clause is optional; with none
     * set this is exactly `listExpenses`. `q` matches description and notes,
     * case-insensitively - SQLite LIKE is already case-insensitive for ASCII.
     */
    async searchExpenses(
      ledgerId: string,
      f: { q?: string; categoryId?: string; memberId?: string; from?: number; to?: number },
    ) {
      const clauses = [eq(t.expenses.ledgerId, ledgerId), isNull(t.expenses.deletedAt)];
      if (f.q) {
        // Escape LIKE wildcards so a user typing "50%" searches for "50%"
        // rather than matching every row. drizzle's `like()` has no ESCAPE
        // option, so the clause is spelled out.
        const pattern = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        clauses.push(
          or(
            // `\'` inside a JS template literal is an escaped quote - it eats the
            // backslash and emits `ESCAPE ''`, an empty (invalid) escape char.
            // `\\'` is what actually puts a literal backslash in the SQL text.
            raw`${t.expenses.description} LIKE ${pattern} ESCAPE '\\'`,
            raw`${t.expenses.notes} LIKE ${pattern} ESCAPE '\\'`,
          )!,
        );
      }
      if (f.categoryId) clauses.push(eq(t.expenses.categoryId, f.categoryId));
      if (f.from !== undefined) clauses.push(gte(t.expenses.paidAt, f.from));
      if (f.to !== undefined) clauses.push(lte(t.expenses.paidAt, f.to));
      // "involving this member" means payer OR participant, so it needs the
      // splits table - a bare payer filter would silently hide their shares.
      if (f.memberId) {
        clauses.push(
          or(
            eq(t.expenses.payerMemberId, f.memberId),
            raw`EXISTS (SELECT 1 FROM ${t.expenseSplits} WHERE ${t.expenseSplits.expenseId} = ${t.expenses.id} AND ${t.expenseSplits.memberId} = ${f.memberId})`,
          )!,
        );
      }
      const rows = await db
        .select()
        .from(t.expenses)
        .where(and(...clauses))
        .orderBy(desc(t.expenses.paidAt));
      return withSplits(rows);
    },
    /**
     * Every live expense the user has a share in, across every ledger they are
     * still a member of. Feeds lifetime analytics. Returns the user's own split
     * amount alongside the expense, because that - not the total - is what they
     * actually spent.
     */
    async listExpenseSharesForUser(userId: string) {
      return db
        .select({
          expenseId: t.expenses.id,
          ledgerId: t.expenses.ledgerId,
          description: t.expenses.description,
          categoryId: t.expenses.categoryId,
          paidAt: t.expenses.paidAt,
          total: t.expenses.total,
          share: t.expenseSplits.amount,
          payerMemberId: t.expenses.payerMemberId,
          memberId: t.ledgerMembers.id,
        })
        .from(t.expenses)
        .innerJoin(t.expenseSplits, eq(t.expenseSplits.expenseId, t.expenses.id))
        .innerJoin(t.ledgerMembers, eq(t.ledgerMembers.id, t.expenseSplits.memberId))
        .innerJoin(t.ledgers, eq(t.ledgers.id, t.expenses.ledgerId))
        .where(
          and(
            eq(t.ledgerMembers.userId, userId),
            isNull(t.expenses.deletedAt),
            isNull(t.ledgerMembers.deletedAt),
            isNull(t.ledgers.deletedAt),
          ),
        )
        .orderBy(desc(t.expenses.paidAt));
    },
    insertExpense: (v: Insert<typeof t.expenses>) => db.insert(t.expenses).values(v),
    insertSplits: (v: Insert<typeof t.expenseSplits>[]) => db.insert(t.expenseSplits).values(v),
    /** Splits carry no deleted_at - they live and die with their expense, and the
     *  prior set survives in the revision snapshot. */
    clearSplits: (expenseId: string) => db.delete(t.expenseSplits).where(eq(t.expenseSplits.expenseId, expenseId)),
    updateExpense: (expenseId: string, v: Partial<Insert<typeof t.expenses>>) =>
      db.update(t.expenses).set(v).where(and(eq(t.expenses.id, expenseId), isNull(t.expenses.deletedAt))),
    softDeleteExpense: (expenseId: string, at: number) =>
      db
        .update(t.expenses)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(t.expenses.id, expenseId), isNull(t.expenses.deletedAt))),
    /** Undo's write path: unlike `updateExpense`, not guarded by isNull(deletedAt) -
     *  undo must be able to reach past a soft-delete to un-delete the row, which
     *  is the one legitimate reason a write here skips that guard. */
    restoreExpense: (expenseId: string, v: Partial<Insert<typeof t.expenses>>) =>
      db.update(t.expenses).set(v).where(eq(t.expenses.id, expenseId)),
    insertRevision: (v: Insert<typeof t.expenseRevisions>) => db.insert(t.expenseRevisions).values(v),
    async listRevisions(expenseId: string) {
      return db
        .select()
        .from(t.expenseRevisions)
        .where(eq(t.expenseRevisions.expenseId, expenseId))
        .orderBy(desc(t.expenseRevisions.revisedAt));
    },

    // ---- settlements -----------------------------------------------------
    async listSettlements(ledgerId: string) {
      return db
        .select()
        .from(t.settlements)
        .where(and(eq(t.settlements.ledgerId, ledgerId), isNull(t.settlements.deletedAt)))
        .orderBy(desc(t.settlements.declaredAt));
    },
    insertSettlement: (v: Insert<typeof t.settlements>) => db.insert(t.settlements).values(v),
    acknowledgeSettlement: (id: string, at: number) =>
      db
        .update(t.settlements)
        .set({ acknowledgedAt: at })
        .where(and(eq(t.settlements.id, id), isNull(t.settlements.deletedAt))),
    softDeleteSettlement: (id: string, at: number) =>
      db.update(t.settlements).set({ deletedAt: at }).where(and(eq(t.settlements.id, id), isNull(t.settlements.deletedAt))),

    // ---- categories ------------------------------------------------------
    async listCategories() {
      return db.select().from(t.categories).where(isNull(t.categories.deletedAt)).orderBy(t.categories.name);
    },
    insertCategory: (v: Insert<typeof t.categories>) => db.insert(t.categories).values(v),
    softDeleteCategory: (id: string, at: number) =>
      db
        .update(t.categories)
        .set({ deletedAt: at })
        // Seeded rows are structural: the charts and the NL parser both assume
        // "Other" exists. Removing a default is not a thing the admin panel does.
        .where(and(eq(t.categories.id, id), eq(t.categories.isDefault, false), isNull(t.categories.deletedAt))),

    // ---- activity --------------------------------------------------------
    //
    // The three helpers below deliberately return rows the ordinary helpers
    // hide: soft-deleted expenses, and members who have left. That is the whole
    // point of an activity feed - "Bob deleted Dinner" and "Cy left" are events,
    // and a feed that silently omits them is lying about what happened.
    //
    // They are named for that single purpose so they cannot be reached for by
    // accident. NOTHING that computes money may call them. Balances read
    // listExpenses/listMembers, which filter, and that is not negotiable.

    /** Includes soft-deleted expenses. Never feed this to a balance. */
    async listExpensesForActivity(ledgerId: string) {
      return db
        .select()
        .from(t.expenses)
        .where(eq(t.expenses.ledgerId, ledgerId))
        .orderBy(desc(t.expenses.createdAt));
    },
    /** Includes members who have left. Never feed this to a balance. */
    async listMembersForActivity(ledgerId: string) {
      return db
        .select()
        .from(t.ledgerMembers)
        .where(and(eq(t.ledgerMembers.ledgerId, ledgerId), isNull(t.ledgerMembers.deletedAt)))
        .orderBy(t.ledgerMembers.joinedAt);
    },
    /** Every revision on this ledger, with the description of what was revised. */
    async listRevisionsForActivity(ledgerId: string) {
      return db
        .select({ revision: t.expenseRevisions, description: t.expenses.description })
        .from(t.expenseRevisions)
        .innerJoin(t.expenses, eq(t.expenses.id, t.expenseRevisions.expenseId))
        .where(eq(t.expenses.ledgerId, ledgerId))
        .orderBy(desc(t.expenseRevisions.revisedAt));
    },

    // ---- comments --------------------------------------------------------
    async listComments(expenseId: string) {
      return db
        .select({ comment: t.comments, author: t.users })
        .from(t.comments)
        .innerJoin(t.users, eq(t.users.id, t.comments.authorUserId))
        .where(and(eq(t.comments.expenseId, expenseId), isNull(t.comments.deletedAt)))
        .orderBy(asc(t.comments.createdAt));
    },
    async listLedgerComments(ledgerId: string) {
      return db
        .select({ comment: t.comments, author: t.users })
        .from(t.comments)
        .innerJoin(t.users, eq(t.users.id, t.comments.authorUserId))
        .where(and(eq(t.comments.ledgerId, ledgerId), isNull(t.comments.deletedAt)))
        .orderBy(desc(t.comments.createdAt));
    },
    async findComment(id: string) {
      const [row] = await db
        .select()
        .from(t.comments)
        .where(and(eq(t.comments.id, id), isNull(t.comments.deletedAt)))
        .limit(1);
      return row;
    },
    insertComment: (v: Insert<typeof t.comments>) => db.insert(t.comments).values(v),
    softDeleteComment: (id: string, at: number) =>
      db.update(t.comments).set({ deletedAt: at }).where(and(eq(t.comments.id, id), isNull(t.comments.deletedAt))),

    // ---- recurring series ------------------------------------------------
    async listSeries(ledgerId: string) {
      return db
        .select()
        .from(t.recurringSeries)
        .where(and(eq(t.recurringSeries.ledgerId, ledgerId), isNull(t.recurringSeries.deletedAt)))
        .orderBy(desc(t.recurringSeries.createdAt));
    },
    async findSeries(id: string) {
      const [row] = await db
        .select()
        .from(t.recurringSeries)
        .where(and(eq(t.recurringSeries.id, id), isNull(t.recurringSeries.deletedAt)))
        .limit(1);
      return row;
    },
    /**
     * Every live, unpaused series that owes at least one occurrence, on a ledger
     * that is neither archived nor deleted. This is the catch-up work list after
     * downtime - the alarm handler drains it, and the unique index on
     * (series_id, occurrence_at) is what makes a replay harmless.
     */
    async listDueSeries(now: number) {
      return db
        .select({ series: t.recurringSeries })
        .from(t.recurringSeries)
        .innerJoin(t.ledgers, eq(t.ledgers.id, t.recurringSeries.ledgerId))
        .where(
          and(
            isNull(t.recurringSeries.deletedAt),
            isNull(t.recurringSeries.pausedAt),
            lte(t.recurringSeries.nextOccurrenceAt, now),
            isNull(t.ledgers.archivedAt),
            isNull(t.ledgers.deletedAt),
          ),
        );
    },
    /**
     * The occurrence instants a series has already generated, including
     * soft-deleted ones. Deliberately NOT filtered by deleted_at: a user who
     * deletes a generated occurrence means "not this one", and catch-up must not
     * helpfully recreate it on the next alarm.
     */
    async listSeriesOccurrences(seriesId: string) {
      const rows = await db
        .select({ occurrenceAt: t.expenses.occurrenceAt })
        .from(t.expenses)
        .where(eq(t.expenses.seriesId, seriesId));
      return rows.map((r) => r.occurrenceAt).filter((v): v is number => v !== null);
    },
    insertSeries: (v: Insert<typeof t.recurringSeries>) => db.insert(t.recurringSeries).values(v),
    updateSeries: (id: string, v: Partial<Insert<typeof t.recurringSeries>>) =>
      db.update(t.recurringSeries).set(v).where(and(eq(t.recurringSeries.id, id), isNull(t.recurringSeries.deletedAt))),
    softDeleteSeries: (id: string, at: number) =>
      db
        .update(t.recurringSeries)
        .set({ deletedAt: at })
        .where(and(eq(t.recurringSeries.id, id), isNull(t.recurringSeries.deletedAt))),

    // ---- push ------------------------------------------------------------
    /** Live subscriptions only - a row the push service has rejected is not one. */
    async listPushSubscriptions(userId: string) {
      return db
        .select()
        .from(t.pushSubscriptions)
        .where(and(eq(t.pushSubscriptions.userId, userId), isNull(t.pushSubscriptions.failedAt)));
    },
    /** Upsert on endpoint: the same browser resubscribing must revive its row,
     *  not collide with the unique index. */
    insertPushSubscription: (v: Insert<typeof t.pushSubscriptions>) =>
      db
        .insert(t.pushSubscriptions)
        .values(v)
        .onConflictDoUpdate({
          target: t.pushSubscriptions.endpoint,
          set: { userId: v.userId, p256dh: v.p256dh, auth: v.auth, failedAt: null },
        }),
    markPushFailed: (endpoint: string, at: number) =>
      db.update(t.pushSubscriptions).set({ failedAt: at }).where(eq(t.pushSubscriptions.endpoint, endpoint)),
    deletePushSubscription: (endpoint: string, userId: string) =>
      db
        .delete(t.pushSubscriptions)
        .where(and(eq(t.pushSubscriptions.endpoint, endpoint), eq(t.pushSubscriptions.userId, userId))),

    // ---- nudges ----------------------------------------------------------
    /** When this pair was last nudged, for the server-side rate limit. */
    async lastNudgeAt(fromUserId: string, toUserId: string) {
      const [row] = await db
        .select({ sentAt: t.nudges.sentAt })
        .from(t.nudges)
        .where(and(eq(t.nudges.fromUserId, fromUserId), eq(t.nudges.toUserId, toUserId)))
        .orderBy(desc(t.nudges.sentAt))
        .limit(1);
      return row?.sentAt;
    },
    insertNudge: (v: Insert<typeof t.nudges>) => db.insert(t.nudges).values(v),

    // ---- instance state --------------------------------------------------
    async getInstanceState(key: string) {
      const [row] = await db.select().from(t.instanceState).where(eq(t.instanceState.key, key)).limit(1);
      return row?.value;
    },
    setInstanceState: (key: string, value: string, at: number) =>
      db
        .insert(t.instanceState)
        .values({ key, value, updatedAt: at })
        .onConflictDoUpdate({ target: t.instanceState.key, set: { value, updatedAt: at } }),
  };

  async function withSplits(rows: (typeof t.expenses.$inferSelect)[]) {
    if (rows.length === 0) return [];
    const splits = await db
      .select()
      .from(t.expenseSplits)
      .where(inArray(t.expenseSplits.expenseId, rows.map((r) => r.id)))
      .orderBy(t.expenseSplits.sortOrder);
    return rows.map((r) => ({ ...r, splits: splits.filter((s) => s.expenseId === r.id) }));
  }
}

export type Db = ReturnType<typeof createDb>;

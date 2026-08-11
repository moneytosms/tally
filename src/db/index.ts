/// <reference types="@cloudflare/workers-types" />
// Data-access layer.
//
// IMPORTANT: soft-delete filtering is enforced HERE, structurally.
// Never leave `deleted_at IS NULL` to individual callers — forgetting once
// produces wrong money. See docs/adr/0004 and SPEC §11 hazard 1.
//
// The drizzle instance is deliberately NOT exported. Reads are only reachable
// through the named helpers below, each of which already excludes deleted rows
// (and left members, where "current member" is what is meant).
//
// Writes return the drizzle statement instead of running it. A statement is
// awaitable, so `await db.insertExpense(...)` executes it; it is also a valid
// batch item, so `db.batch([...])` runs several atomically. D1 has no
// cross-request transaction — batch is what keeps the 1:1 ledger auto-create
// and bulk settle from half-applying (SPEC §11 hazard 2).
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
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
    insertUser: (v: Insert<typeof t.users>) => db.insert(t.users).values(v),
    updateUser: (id: string, v: Partial<Insert<typeof t.users>>) =>
      db.update(t.users).set(v).where(and(eq(t.users.id, id), isNull(t.users.deletedAt))),

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
    /** Unconsumed, unrevoked, unexpired invite on a live ledger. */
    async findUsableInvite(tokenHash: string, now: number) {
      const [row] = await db
        .select({ invite: t.invites, ledger: t.ledgers })
        .from(t.invites)
        .innerJoin(t.ledgers, eq(t.ledgers.id, t.invites.ledgerId))
        .where(
          and(
            eq(t.invites.tokenHash, tokenHash),
            isNull(t.invites.consumedAt),
            isNull(t.invites.revokedAt),
            gt(t.invites.expiresAt, now),
            isNull(t.ledgers.deletedAt),
          ),
        )
        .limit(1);
      return row;
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
    insertExpense: (v: Insert<typeof t.expenses>) => db.insert(t.expenses).values(v),
    insertSplits: (v: Insert<typeof t.expenseSplits>[]) => db.insert(t.expenseSplits).values(v),
    /** Splits carry no deleted_at — they live and die with their expense, and the
     *  prior set survives in the revision snapshot. */
    clearSplits: (expenseId: string) => db.delete(t.expenseSplits).where(eq(t.expenseSplits.expenseId, expenseId)),
    updateExpense: (expenseId: string, v: Partial<Insert<typeof t.expenses>>) =>
      db.update(t.expenses).set(v).where(and(eq(t.expenses.id, expenseId), isNull(t.expenses.deletedAt))),
    softDeleteExpense: (expenseId: string, at: number) =>
      db
        .update(t.expenses)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(t.expenses.id, expenseId), isNull(t.expenses.deletedAt))),
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

// Drizzle schema for D1 (SQLite). Spec: docs/SPEC.md §4-§7, §12. ADR 0003, 0004.
//
// Non-negotiable:
//   - money is integer paise (negative totals are legal: refunds)
//   - ids are UUIDv7 text, generated in app code (src/shared/id.ts)
//   - timestamps are integer epoch ms, never SQLite date/text types
//   - deleted_at on every soft-deletable table
//   - balances are DERIVED - there is no net-position column anywhere
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    vpa: text("vpa"),
    // Always stored lowercased - the unique index is the only thing preventing
    // two accounts on the same address, and SQLite's = is case-sensitive.
    // Null for accounts that only ever enrolled a passkey.
    email: text("email"),
    // PBKDF2 string from src/server/auth/password.ts. Null = passkey-only account.
    passwordHash: text("password_hash"),
    isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    // exactly one instance owner
    uniqueIndex("users_owner_uq").on(t.isOwner).where(sql`${t.isOwner} = 1`),
    // SQLite treats NULLs as distinct, so passkey-only accounts don't collide.
    uniqueIndex("users_email_uq").on(t.email),
  ],
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  // SimpleWebAuthn credential.id - base64url, unique across the instance
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(), // base64url COSE key
  counter: integer("counter").notNull().default(0),
  transports: text("transports"), // JSON array, nullable
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  // recovery revokes the lost credential rather than only adding a new one
  revokedAt: integer("revoked_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // never store the plaintext token
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  userAgent: text("user_agent"),
});

/**
 * Owner-issued account recovery. Bound to a USER, not a ledger - that is the
 * whole difference from an invite, and the reason this is a separate table:
 * an invite enrols a NEW person, a recovery token re-enrols an EXISTING one and
 * must never create a second account (which would orphan their expense history).
 *
 * Same handling rules as an invite: 256-bit token, returned once, stored only as
 * a SHA-256 hash, single-use, never logged. Shorter TTL because the owner hands
 * it over directly rather than mailing it out.
 */
export const recoveryTokens = sqliteTable("recovery_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // never store the plaintext token
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(), // 1h
  consumedAt: integer("consumed_at"),
  revokedAt: integer("revoked_at"),
});

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // never store the plaintext token
  // NULL = an INSTANCE invite: it admits someone to tally itself without
  // putting them in any ledger. Non-null = the original ledger invite, which
  // also joins that one ledger. Both are single-use bearer tokens.
  ledgerId: text("ledger_id").references(() => ledgers.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(), // 48h
  consumedAt: integer("consumed_at"),
  consumedBy: text("consumed_by").references(() => users.id),
  revokedAt: integer("revoked_at"),
});

export const ledgers = sqliteTable("ledgers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  endDate: integer("end_date"), // set => trip with burn-rate
  budget: integer("budget"), // paise, set => budget tracking
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
  deletedAt: integer("deleted_at"),
});

export const ledgerMembers = sqliteTable(
  "ledger_members",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    userId: text("user_id").references(() => users.id),
    guestName: text("guest_name"),
    nickname: text("nickname"),
    joinedAt: integer("joined_at").notNull(),
    leftAt: integer("left_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check(
      "ledger_members_user_xor_guest",
      sql`(${t.userId} IS NULL) <> (${t.guestName} IS NULL)`,
    ),
    uniqueIndex("ledger_members_ledger_user_uq").on(t.ledgerId, t.userId),
    index("ledger_members_ledger_idx").on(t.ledgerId),
    index("ledger_members_user_idx").on(t.userId),
  ],
);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  icon: text("icon").notNull(),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: integer("deleted_at"),
});

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    description: text("description").notNull(),
    total: integer("total").notNull(), // paise, may be negative (refund)
    currency: text("currency").notNull().default("INR"), // ADR 0003: constant
    paidAt: integer("paid_at").notNull(),
    payerMemberId: text("payer_member_id")
      .notNull()
      .references(() => ledgerMembers.id),
    categoryId: text("category_id").references(() => categories.id),
    notes: text("notes"),
    mode: text("mode").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    // Set only on generated occurrences. The unique index below is what makes
    // recurring catch-up idempotent - a retry hits the constraint instead of
    // creating a second copy (SPEC §11 hazard 5). Do not enforce this in app
    // code; app code forgets and the DB does not.
    seriesId: text("series_id"),
    occurrenceAt: integer("occurrence_at"),
  },
  (t) => [
    check(
      "expenses_mode_ck",
      sql`${t.mode} IN ('equal', 'exact', 'shares', 'percent')`,
    ),
    check("expenses_total_nonzero_ck", sql`${t.total} <> 0`),
    check("expenses_currency_ck", sql`${t.currency} = 'INR'`),
    check(
      "expenses_series_pair_ck",
      sql`(${t.seriesId} IS NULL) = (${t.occurrenceAt} IS NULL)`,
    ),
    index("expenses_ledger_idx").on(t.ledgerId),
    index("expenses_category_idx").on(t.categoryId),
    uniqueIndex("expenses_series_occurrence_uq").on(t.seriesId, t.occurrenceAt),
  ],
);

export const expenseSplits = sqliteTable(
  "expense_splits",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    memberId: text("member_id")
      .notNull()
      .references(() => ledgerMembers.id),
    amount: integer("amount").notNull(), // resolved paise; 0 is legal on a refund
    inputValue: integer("input_value"), // raw per-mode input; null for equal
    sortOrder: integer("sort_order").notNull(), // stable order - rounding depends on it
  },
  (t) => [
    uniqueIndex("expense_splits_expense_member_uq").on(t.expenseId, t.memberId),
    index("expense_splits_expense_idx").on(t.expenseId),
    index("expense_splits_member_idx").on(t.memberId),
  ],
);

// Append-only: the complete before-state of an expense, written on every edit.
export const expenseRevisions = sqliteTable(
  "expense_revisions",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    snapshot: text("snapshot").notNull(), // JSON: prior expense + its splits
    revisedBy: text("revised_by")
      .notNull()
      .references(() => users.id),
    revisedAt: integer("revised_at").notNull(),
  },
  (t) => [index("expense_revisions_expense_idx").on(t.expenseId)],
);

export const settlements = sqliteTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    fromMemberId: text("from_member_id")
      .notNull()
      .references(() => ledgerMembers.id),
    toMemberId: text("to_member_id")
      .notNull()
      .references(() => ledgerMembers.id),
    amount: integer("amount").notNull(), // paise
    currency: text("currency").notNull().default("INR"), // ADR 0003: constant
    method: text("method").notNull(),
    note: text("note"),
    declaredBy: text("declared_by")
      .notNull()
      .references(() => users.id),
    declaredAt: integer("declared_at").notNull(),
    acknowledgedAt: integer("acknowledged_at"), // a tick, never a gate
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check(
      "settlements_method_ck",
      sql`${t.method} IN ('upi', 'manual', 'forgiven')`,
    ),
    check("settlements_amount_positive_ck", sql`${t.amount} > 0`),
    check("settlements_distinct_members_ck", sql`${t.fromMemberId} <> ${t.toMemberId}`),
    check("settlements_currency_ck", sql`${t.currency} = 'INR'`),
    index("settlements_ledger_idx").on(t.ledgerId),
  ],
);

// Single-row-per-key instance flags, e.g. the burned bootstrap secret.
export const instanceState = sqliteTable("instance_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// A comment on an expense. The activity feed is DERIVED from expenses,
// settlements and these - there is no activity table, because every row it
// would hold already exists somewhere else.
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check("comments_body_nonempty_ck", sql`length(trim(${t.body})) > 0`),
    index("comments_expense_idx").on(t.expenseId),
    index("comments_ledger_idx").on(t.ledgerId),
  ],
);

// A recurring expense template. One Durable Object alarm per live series.
// Generation is idempotent structurally: see the unique index on
// (series_id, occurrence_at) over expenses. A retry cannot double-create.
export const recurringSeries = sqliteTable(
  "recurring_series",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    description: text("description").notNull(),
    total: integer("total").notNull(), // paise
    payerMemberId: text("payer_member_id")
      .notNull()
      .references(() => ledgerMembers.id),
    categoryId: text("category_id").references(() => categories.id),
    notes: text("notes"),
    mode: text("mode").notNull(),
    // The split template: JSON [{ memberId, inputValue }] in stable order.
    // Amounts are re-resolved at generation time so the remainder rule applies
    // to each occurrence, exactly as it would for a hand-entered expense.
    splitTemplate: text("split_template").notNull(),
    intervalUnit: text("interval_unit").notNull(), // day | week | month
    intervalCount: integer("interval_count").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at"), // null => runs until the ledger is archived
    // The occurrence this series has generated up to, exclusive. Catch-up walks
    // forward from here, so downtime replays deterministically.
    nextOccurrenceAt: integer("next_occurrence_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    pausedAt: integer("paused_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check("recurring_mode_ck", sql`${t.mode} IN ('equal', 'exact', 'shares', 'percent')`),
    check("recurring_unit_ck", sql`${t.intervalUnit} IN ('day', 'week', 'month')`),
    check("recurring_count_positive_ck", sql`${t.intervalCount} > 0`),
    check("recurring_total_nonzero_ck", sql`${t.total} <> 0`),
    index("recurring_ledger_idx").on(t.ledgerId),
  ],
);

// A Web Push subscription. One row per browser, not per user - a user with a
// phone and a laptop has two. Push is single-recipient by design (SPEC §9),
// so this is never fanned out across more than one user's rows.
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at").notNull(),
    // Set when the push service returns 404/410. The row is kept, not deleted,
    // so a resubscribe from the same browser reuses it rather than colliding.
    failedAt: integer("failed_at"),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// Server-side rate limit for manual settle reminders ("nudges"). SPEC §9:
// reminders are manual and rate-limited server-side, with no scheduled sweep.
export const nudges = sqliteTable(
  "nudges",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => users.id),
    sentAt: integer("sent_at").notNull(),
  },
  (t) => [index("nudges_pair_idx").on(t.fromUserId, t.toUserId, t.sentAt)],
);

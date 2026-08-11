// Drizzle schema for D1 (SQLite). Spec: docs/SPEC.md §4-§7, §12. ADR 0003, 0004.
//
// Non-negotiable:
//   - money is integer paise (negative totals are legal: refunds)
//   - ids are UUIDv7 text, generated in app code (src/shared/id.ts)
//   - timestamps are integer epoch ms, never SQLite date/text types
//   - deleted_at on every soft-deletable table
//   - balances are DERIVED — there is no net-position column anywhere
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
    isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    // exactly one instance owner
    uniqueIndex("users_owner_uq").on(t.isOwner).where(sql`${t.isOwner} = 1`),
  ],
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  // SimpleWebAuthn credential.id — base64url, unique across the instance
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

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // never store the plaintext token
  ledgerId: text("ledger_id")
    .notNull()
    .references(() => ledgers.id),
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
  },
  (t) => [
    check(
      "expenses_mode_ck",
      sql`${t.mode} IN ('equal', 'exact', 'shares', 'percent')`,
    ),
    check("expenses_total_nonzero_ck", sql`${t.total} <> 0`),
    check("expenses_currency_ck", sql`${t.currency} = 'INR'`),
    index("expenses_ledger_idx").on(t.ledgerId),
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
    sortOrder: integer("sort_order").notNull(), // stable order — rounding depends on it
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

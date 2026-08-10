// Drizzle schema for D1 (SQLite). Full spec: docs/SPEC.md §4-§7, ticket #10.
//
// Tables: users, credentials, sessions, invites, ledgers, ledger_members,
// expenses, expense_splits, expense_revisions, settlements, categories,
// comments, activity, recurring_series, push_subscriptions, rate_limits.
//
// Non-negotiable:
//   - money is integer paise
//   - ids are UUIDv7 text
//   - deleted_at on every soft-deletable table
//   - ledger_members: exactly one of user_id / guest_name (CHECK constraint)
//   - balances are DERIVED, never columns
export {};

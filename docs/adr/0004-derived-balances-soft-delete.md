# 4. Balances are derived; deletion is soft

Date: 2026-08-11 · Status: accepted

## Context

Balances could be materialised for speed. Expenses could be hard-deleted for simplicity. Both are the conventional choice and both are wrong here.

Scale is ~20 users and thousands of expenses — comfortably fast to compute on read.

## Decision

**Net positions are derived from expenses and settlements, never stored.**

**Everything is soft-deleted.** Rows carry `deleted_at` and are excluded from balances.

Edit history is **mutable rows plus an `expense_revisions` table** holding the complete before-state, not an event log and not row versioning.

## Consequences

- A cached balance that disagrees with expense history is a far worse bug than a slow query. If computation ever becomes slow, cache it — but only then.
- Soft-delete makes deletion reversible and lets an expense that has been settled against be removed without corrupting the record of what was paid.
- **The hazard**: every query must filter deleted rows, and forgetting once produces wrong money. This must be enforced **structurally** in the data-access layer — a default scope or repository method — never left to each caller. It is the most likely source of a silent balance error in this codebase.
- An event log was rejected: elegant, but every read becomes a fold or needs a projection to keep in sync. Row versioning was rejected: it doubles the "remember the flag" hazard that soft-delete already imposes once.

# 5. Any member can edit anything; leaving requires a zero balance

Date: 2026-08-11 · Status: accepted

## Context

Permission models for shared expense apps usually restrict editing to the creator or payer. That produces expenses nobody can fix when someone stops using the app, and needs an owner override anyway - so roles arrive through the back door.

Separately, people leave groups owing money.

## Decision

**Any member can edit or delete any expense in a ledger they belong to.** The audit trail is the control, not the permission.

**Leaving is blocked while a member's net position is non-zero.** They settle, or another member explicitly forgives the amount (recorded as a Settlement with method `forgiven`).

## Consequences

- Only safe because edit history and undo exist. The two decisions are a package - removing undo would invalidate this one.
- Authorisation collapses to a single question: *is the caller a current member of this ledger?* One Hono middleware, with exactly two exceptions (ledger deletion is creator-only, admin routes are owner-only).
- The leaving rule buys a genuine system-wide invariant: **every ledger's net positions sum to zero, and every member is a current member.** No former-member state leaks into any query, screen, or analytic.
- Accepted cost: someone can be held in a ledger by a debt they dispute. The escape hatch is explicit forgiveness, which is recorded rather than silent.

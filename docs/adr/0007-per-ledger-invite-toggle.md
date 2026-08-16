# 0007 - Ledger invites are opt-in per ledger

Status: accepted
Date: 2026-08-16

## Context

Any member of any ledger could mint an invite link (ADR 0005). That is right for
a trip, where someone is always being added, and wrong for a long-standing flat
or a 1:1, where the roster settled months ago and a live invite path is only a
way to lose control of the instance.

An invite is a bearer credential: holding the link is holding account access
(CONTEXT.md). A standing ability to mint one on every ledger forever is a
permission nobody asked for.

## Decision

**`ledgers.invites_enabled`, default FALSE.** Settable at creation and via
`PATCH /ledgers/:ledgerId`. Any member may flip it, in keeping with ADR 0005 -
there are no roles here either.

`POST /ledgers/:ledgerId/invites` refuses with **409 `invites_disabled`** while
it is off.

**Disabling also kills the links already handed out.** That is enforced in the
data-access layer, in the `redeemable` predicate shared by `findUsableInvite` and
`listOpenInvites`, not by revoking rows: a ledger invite is only usable while its
ledger is live *and* invite-enabled. Instance invites (`ledger_id` null) are
untouched - they belong to the Owner and to no ledger.

## Consequences

- Every ledger that existed before this migration arrives with FALSE. That is the
  point, not a migration wart: no ledger silently keeps an invite path it never
  opted into, and any invite already open on one stops working the moment the
  column lands.
- Because the rule is a WHERE clause rather than a revocation, re-enabling a
  ledger revives its unexpired invites. A leaked link is therefore not made safe
  by toggling off and on again - revoke it, which is what
  `DELETE /ledgers/:ledgerId/invites/:inviteId` is for.
- Adding an existing user directly (`POST /ledgers/:ledgerId/members`) is
  deliberately NOT gated. It needs an account that already exists on the
  instance, so it admits nobody new and is not a bearer credential.
- Accepted cost: enabling invites is one extra step before sharing a trip.

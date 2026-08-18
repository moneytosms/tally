# 0008 - Ledger-invite joiners are restricted accounts by default

Status: accepted
Date: 2026-08-19

## Context

Every account today has the same run of the instance regardless of how it was
created (ADR 0006). That was fine when the only invite path was the owner's
admin panel. It stops being fine once any member can hand out a ledger invite
(ADR 0007): the invite is meant to admit someone to *one* ledger, but the
account it creates can list every other ledger's existence-hidden-by-membership
notwithstanding, create new ledgers, and mint its own invites - full run of an
instance the owner never chose to open that wide.

This is not the question ADR 0005 or ADR 0007 answered. Those govern
authorization *inside* a ledger someone already belongs to - "no roles" there
means no editor/viewer split once you're a member. This is a different axis:
what an account may do *before* or *outside* any ledger membership - create
one, invite into one, see the instance-wide list. Silently reusing "no roles"
for that question would be answering it, not applying it.

## Decision

**`users.accountType: 'full' | 'restricted'`, set at invite redemption.**
Redeeming a ledger invite (`invites.ledger_id` non-null) creates a
`restricted` account; redeeming an instance invite (`ledger_id` null,
owner-issued per ADR 0006) creates a `full` account, matching today's
behaviour for that path.

**Restricted means scoped to current memberships, nothing else.** Inside a
ledger a restricted account is a member like any other - ADR 0005 is
untouched. Outside one, `POST /ledgers` and `POST /ledgers/:id/invites`
(and any future instance- or ledger-creation route) are refused. One
middleware, extending the membership check from ADR 0005 with this one extra
gate.

**Promotion is owner-only and one-directional.** The owner flips
`accountType` to `full`; there is no demotion path in this decision. A
promoted account keeps every membership it already had - promotion only adds
capability.

## Consequences

- The instance now has two account shapes instead of one. `hasPassword`
  already taught the client to check account completeness (ADR 0006);
  `accountType` is the same kind of flag on the same `/me` payload, not a new
  concept for the client to learn.
- A restricted account that later wants to start its own trip has no
  self-service path - it waits on the owner. Accepted: the alternative is
  self-promotion, which defeats the point of scoping the invite in the first
  place.
- Ledger invites now carry two effects instead of one: membership in a
  ledger, and an account ceiling. Revoking or disabling the invite (ADR 0007)
  does not touch the ceiling already applied to accounts created from it.

## Alternatives rejected

- **Per-ledger ACL table instead of an account-level flag.** Would duplicate
  what `ledger_members` already encodes and answers a question nobody asked -
  nothing here needs per-ledger grants independent of membership.
- **Leaving it as a client-side hint (hide the buttons, trust the client).**
  The gate has to be server-side or it isn't a gate; a restricted account
  calling `POST /ledgers` directly would otherwise succeed.

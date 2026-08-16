# tally - domain context

Ubiquitous language for this codebase. When code, tickets, tests, or UI copy name a domain concept, use **these** terms. If a concept you need isn't here, either you're inventing language the project doesn't use, or there's a real gap worth adding.

Decisions live in [`docs/adr/`](docs/adr/). The buildable spec is [`docs/SPEC.md`](docs/SPEC.md). The reasoning behind every decision is on [the wayfinder map](https://github.com/moneytosms/tally/issues/1).

---

## Core

**Ledger** - the one container concept. A set of members who share expenses. A trip, a one-to-one, and a long-standing group are all Ledgers, differentiated only by whether `end_date` and `budget` are set.

> Never say "group". A Ledger with many members is still a Ledger.

**Member** - a participant in a Ledger. Either a **User** or a **Guest**. Identified by `ledger_members.id`, not by user id - expenses reference members, not users, because guests have no user.

**User** - a real person with an account, at least one **Credential**, and a profile. Users are principals: they authenticate and act.

**Guest** - a named participant who never logs in, managed by the ledger owner. Guests split like anyone and can be a payer. **Guests are data, never principals** - no code path authenticates as a guest.

**Expense** - a thing that was paid for, by one **Payer**, split among one or more **Participants**. A negative total is a **Refund**.

**Payer** - the member who paid. Exactly one per Expense. **Need not be a Participant.**

**Participant** - a member the Expense is split among. Any subset of the Ledger's members. Excluding someone means leaving them out - there is no zero-share participant.

**Split** - one participant's resolved share of an Expense, in paise. Stored resolved, never recomputed from weights.

**Split mode** - how the user expressed the division: `equal`, `exact`, `shares`, `percent`. Kept alongside the resolved splits so the editor reopens as they left it.

**Settlement** - a record that money moved between two members. Declared by the payer; the payee is notified, not asked. May be partial. May be `upi`, `manual`, or `forgiven`.

---

## Balances

**Net position** - one number per member per Ledger: what they are owed (positive) or owe (negative). **Derived, never stored.**

> Don't say "balance" when you mean a net position for one member in one ledger. "Balance" is loose; net position is exact.

**Cross-ledger net balance** - the sum of one person's net positions across every Ledger shared with the viewer. One number per friend.

**Transfer plan** - the derived, minimal set of payments that would clear a Ledger. Never stored, recomputed on every change. Each suggested transfer must be explainable via its **trail**.

**Trail** - the chain of expenses justifying a suggested transfer. What the "why?" affordance shows.

**Bulk settle** - one action clearing a person's cross-ledger net balance, writing Settlements into each contributing Ledger.

**Simplify** - collapsing net positions into the fewest transfers. Always on, always a view, never mutates stored data.

---

## Lifecycle

**Archive** - a Ledger closed because it's settled. Requires all net positions at zero. Read-only, reopenable, still searchable and still feeding analytics.

**Reopen** - return an archived Ledger to active. Any member may. Logged.

**Leave** - a member exiting a Ledger. **Blocked while their net position is non-zero.**

**Forgive** - another member explicitly writing off a debt so its holder can leave. Recorded as a Settlement with method `forgiven`. Never silent.

**Soft-delete** - flagging a row as deleted without removing it. The only kind of deletion tally has.

**Revision** - a snapshot of an Expense's prior state, written on every edit. What undo restores from.

---

## Identity

**Instance** - this single deployment. There is exactly one.

**Owner** - the person who runs the Instance. Claims it with the **bootstrap secret**, holds the admin panel, manages Guests, and performs passkey recovery.

**Invite** - a single-use, 48-hour, hashed token admitting a **new** User. A **ledger invite** also joins them to one Ledger; an **instance invite** (issued by the Owner, no ledger attached) only creates the account. A leaked Invite is potentially account access. There is no public signup - an Invite is the only way an account comes into being (ADR 0006).

**Invite-enabled** - a property of one Ledger: whether it may mint ledger invites at all. Off by default, so a long-standing group has no invite path and a trip turns one on. Turning it off also kills the ledger's already-open Invites - they are bearer credentials, not a standing permission (ADR 0007).

**Recovery token** - a single-use, one-hour, hashed token the Owner issues to re-enrol an **existing** User on a new device. Bound to a User, not a Ledger, and it never creates an account - that is what separates it from an Invite. Revoking a User's last Credential is refused for the same reason.

**Credential** - a way to sign in. Two kinds: a registered **passkey** (a User may hold several; recovery **revokes** the lost one) and a **password**, which is an email plus a PBKDF2 hash and of which a User has at most one. Either kind alone is a complete account (ADR 0006).

**RP ID** - the WebAuthn Relying Party identifier. Permanently `tally.<account>.workers.dev`. A frozen constant. Never derived at runtime.

**VPA** - a UPI Virtual Payment Address (`name@bank`). Lives on the profile, visible **only to ledger co-members**. Guests have none.

---

## Money

**Paise** - the unit. All amounts are integer paise. **There is no float anywhere in this system.**

**Remainder** - the odd paise left when a total doesn't divide evenly. **Absorbed by the Payer**, or by the first participant in stable order if the payer isn't a participant.

**Stable order** - order of addition to an Expense. Never display order, never re-sortable. Rounding depends on it.

---

## Non-terms

Words that do **not** appear in this domain, and what to say instead:

| Don't say | Say |
|---|---|
| Group | Ledger |
| Debt / IOU | Net position, or Transfer |
| Payment (of a settlement) | Settlement |
| Friend (as an entity) | User |
| Placeholder / ghost user | Guest |
| Trip / event (as a type) | Ledger with an `end_date` |
| Balance (ambiguously) | Net position, or Cross-ledger net balance |
| Rupees (in code) | Paise |

# Architecture

How tally is actually put together, and why. For the domain vocabulary see
[`CONTEXT.md`](../CONTEXT.md); for the decisions and their reasoning see
[`docs/adr/`](adr/); for the product spec see [`docs/SPEC.md`](SPEC.md).

---

## One deployable

```
                    ┌──────────────────────────────────────┐
   browser  ──────► │  Cloudflare Worker (one origin)      │
   (React SPA)      │                                      │
                    │  /api/*        → Hono routers        │
                    │  /*            → static assets       │
                    │  RecurringAlarm → Durable Object     │
                    └───────────┬──────────────────────────┘
                                │
                          ┌─────▼─────┐
                          │  D1       │  SQLite at the edge
                          └───────────┘
```

One Worker serves both the SPA and the API, so there is one origin and no CORS.
That is not a convenience — the WebAuthn RP ID is derived from that single host
and is frozen forever ([ADR 0002](adr/0002-rp-id-is-permanent.md)).

## Layers

| Layer | Where | Rule it enforces |
|---|---|---|
| Schema | `src/db/schema.ts` | Constraints live in the DB where SQLite allows it |
| Data access | `src/db/index.ts` | **Soft-delete filtering, structurally** |
| Pure domain | `src/shared/` | Money, splits, recurrence, NL parsing — no I/O |
| Derivation | `src/server/balances.ts` | Net positions and transfer plans, never stored |
| Routes | `src/server/routes/` | Validation, authorisation, wire shapes |
| Client | `src/client/` | Rendering only; never recomputes money |

### The data-access layer is the security boundary for deletion

`src/db/index.ts` deliberately does **not** export the drizzle instance. Every
read goes through a named helper that already excludes soft-deleted rows, and
"current member" helpers also exclude members who have left.

This is the single most important structural decision in the codebase. Soft-delete
filtering left to callers gets forgotten exactly once, and the result is wrong
money that nobody notices ([ADR 0004](adr/0004-derived-balances-soft-delete.md),
SPEC §11 hazard 1).

Writes are the exception: they return the drizzle statement rather than running
it, so a caller can either `await` it directly or pass several to `db.batch([...])`.

### Batching, because D1 has no transactions

D1 has no cross-request transaction. Three operations must not half-apply:

- an expense and its splits
- a bulk settle writing across several ledgers
- an undo restoring an expense and its splits

All three use `db.batch([...])`. If you add a fourth multi-statement write,
it goes in a batch too — a half-applied money write is the worst bug this
system can have.

## Money

**Integer paise everywhere.** Storage, API, and every calculation. There is no
float anywhere in this system, and `parseFloat` on a money value is a defect.

Splits are **resolved once, at save time**, and stored. Nothing recomputes a
stored split from its weights — the `mode` and each participant's raw
`inputValue` are kept alongside so the editor reopens exactly as the user left
it, but the authoritative numbers are the resolved ones.

The **remainder** — the odd paise when a total does not divide evenly — is
absorbed by the payer, or by the first participant in stable order if the payer
is not a participant. **Stable order is order of addition, never display order.**
Re-sorting participants would silently change who absorbs the remainder.

**Balances are derived**, never stored or cached. Every net position is computed
from expenses and settlements on read. This is why the client never patches a
balance optimistically — it invalidates and refetches.

## Authentication

Passkeys only, via SimpleWebAuthn. No passwords, no email.

- The **RP ID is a frozen constant** in `src/shared/rp-id.ts`. It is never
  derived from `location.hostname`. Changing it destroys every passkey on the
  instance with no migration path.
- The **Owner** claims the instance once with a bootstrap secret from the Worker
  environment, which is burned on use.
- Everyone else arrives through a single-use, 48-hour, hashed **Invite**. An
  invite is also the recovery path, which means a leaked invite is potentially
  account access — hence the admin panel can list and revoke live ones.
- **Guests are data, never principals.** No code path authenticates as a guest.
  A guest has no `user_id` and cannot hold a VPA.

VPAs are visible only to ledger co-members. That rule has exactly one
enforcement point: `serialiseUser(user, sharesLedgerWithViewer)` in
`src/server/routes/me.ts`. Never spread a user row into a response.

## Scheduled work

Exactly two things run on a timer, and neither fans out:

1. **Recurring expenses** — one Durable Object (`RecurringAlarm`) holds one
   alarm set to the earliest due series.
2. Nothing else. There is no sweep, no cron across users.

Push has **exactly two triggers, both single-recipient**: someone settled with
you, and a manual reminder. Notification on split inclusion was deliberately
dropped — it was the only high-fan-out path, and removing it means tally never
notifies more than one person at a time, which keeps the 10 ms CPU ceiling off
the risk list.

### Recurring is idempotent by construction

SPEC §11 hazard 5: a retry must never double-create. Three layers, in
decreasing order of trust:

1. The occurrence sequence is a **pure function** of the cadence
   (`src/shared/recurrence.ts`), so a replay asks for the same instants.
2. `runCatchUp` reads back which instants exist and skips them.
3. A **unique index on `(series_id, occurrence_at)`** rejects anything that gets
   past step 2 — a crash between the insert and the cursor advance, or two
   alarms racing.

The database is the authority. The check above it only keeps the happy path from
throwing. The cursor is advanced *after* the inserts on purpose: advancing first
would silently skip occurrences, whereas advancing last makes a replay a no-op.

## Push encryption

`src/server/push.ts` implements RFC 8291 (`aes128gcm`) and RFC 8292 (VAPID) on
WebCrypto directly. There is no dependency for this: the `web-push` package is
Node-only and does not run on Workers.

`src/server/push.test.ts` proves the crypto by decrypting what the server
produces with the recipient's private key, deriving the keys independently. If
you change the encryption and that test still passes, the change is safe.

## Client

React SPA, TanStack Query, React Router. No global state library — the server is
the state.

- `staleTime` is 0 everywhere. Every number is money someone acts on.
- **No API response is ever cached in the service worker.** A stale balance is
  worse than no balance. The service worker precaches the shell and bundles and
  has no runtime-caching rule at all — an allowlist that cannot drift.
- **Offline shows an explicit state and no numbers.** A wrong number about money
  is worse than no number.
- **Writes offline fail immediately and visibly.** No queue, no outbox, no retry.
- **Updates prompt; never auto-reload** — that would destroy a half-filled
  expense form. The API therefore tolerates one version of skew: response shapes
  stay additive, and a field is never removed or repurposed.
- Recharts is lazy-loaded. It is the largest thing in the bundle.

Every user-facing string goes through `t()` from `src/client/i18n.ts` — a plain
helper over `locales/en.json` plus native `Intl.PluralRules`. English only, but
the layer ships from line one because retrofitting extraction is the expensive
path.

## Testing

`pnpm test` runs vitest. Route tests run against **real SQLite** (`node:sqlite`,
in memory) behind the D1 interface, applying the **actual migration files** —
so they exercise the real data-access layer, the real constraints, and the real
middleware. See `src/server/routes/_test-harness.ts`.

A new migration is picked up automatically. One that does not apply cleanly
fails every route test, which is when you want to hear about it.

What the tests assert, in priority order:

- the invariants in SPEC §12 (positions sum to zero, splits sum to their total,
  a member with a non-zero balance cannot leave, …)
- the split worked examples
- idempotency of recurring catch-up
- that soft-deleted rows are invisible to every read path

Amounts in tests are integer paise, written with a comment giving the rupee value.

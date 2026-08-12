# tally - v1 spec

Self-hosted expense splitting for friend groups. PWA.

Synthesised from [the wayfinder map](https://github.com/moneytosms/tally/issues/1) and its eighteen closed decision tickets. Each section links the ticket holding the full reasoning; this document is the buildable summary, not a replacement for them.

---

## 1. What tally is

A single self-hosted instance, run by one person, used by their friend groups to track shared expenses and settle up. It records who owes what. It never moves money.

**Not** a product, not multi-tenant, not for public signup.

### Fixed constraints

| | |
|---|---|
| Deployment | One instance, run by the owner. Distributable self-hosting is not a feature. |
| Money | Ledger only. `upi://` deep links on settle-up. No funds touch the server. |
| Offline | Online-only with optimistic UI. No write queue, no conflict resolution. |
| Auth | Invite link + passkey. No passwords, no SMTP. |
| Currency | INR only. |
| Language | English only, behind a `t()` layer so others can be added. |
| Budget | $0/mo. |
| Scale | ~20 people, a few ledgers, thousands of expenses over years. |

---

## 2. Stack

[Stack decision](https://github.com/moneytosms/tally/issues/9) · [Hosting research](https://github.com/moneytosms/tally/issues/3)

TypeScript end to end, one deployable.

| Layer | Choice |
|---|---|
| Host | Cloudflare Workers |
| Database | D1 (SQLite) |
| Query layer | Drizzle + `drizzle-kit` |
| API | Hono |
| Auth | SimpleWebAuthn |
| Frontend | React + Vite |
| Rendering | SPA + JSON API |
| Routing | React Router, SPA mode |
| Server state | TanStack Query |
| Validation | Zod, one schema shared client/server |
| Charts | Recharts, lazy-loaded |
| PWA | `vite-plugin-pwa` (Workbox) |
| Scheduling | Durable Object Alarms |
| Styling | Tailwind + shadcn/ui (restyled) |

A single Worker serves static assets and `/api/*`. One origin, so no CORS - which is a security property, not just convenience.

**SPA over SSR** because the host's 10 ms CPU ceiling per invocation is the binding constraint. SSR spends that budget on every navigation.

---

## 3. Origin - decide before writing auth code

[Origin and RP ID](https://github.com/moneytosms/tally/issues/13)

Ship on `tally.<account>.workers.dev`. **That host is the permanent WebAuthn RP ID.**

- The exact string is unknowable until the Cloudflare account exists. Once known it is **frozen** - a constant in one module, never derived from `location.hostname`.
- Serve `/.well-known/webauthn` from the first deploy, listing permitted origins. This is what lets a custom domain be adopted later **with no re-enrolment**.
- **The Cloudflare account is now permanent infrastructure.** Deleting or renaming it destroys every passkey.

---

## 4. Domain model

### Ledger

[Ledger lifecycle](https://github.com/moneytosms/tally/issues/7)

One concept. Trip, one-to-one, and long-standing group are the same entity, differentiated by two nullable columns:

- `end_date` null → standing group; set → trip with burn-rate tracking
- `budget` null → no budget tracking; set → budget + burn rate

**Bounded outings become separate ledgers with cloned members**, not nested ledgers and not event tags. A movie night split off from a standing college group is its own ledger with its own balances, settled and archived independently. Cross-ledger balances and bulk settle are what make this decomposition work.

**One-to-one ledgers auto-create on first shared expense.** Creation and first expense are one atomic operation; a second casual expense with the same person must find the existing ledger.

### Membership

- Any member can invite. The instance owner can revoke anyone.
- Joining mid-ledger is allowed; joiners see full history and carry **no retroactive liability** (participants are explicit per expense).
- The creator is recorded and holds exactly one special power: deleting the ledger. Otherwise all members are equal.
- **Guests**: owner-managed participants who never log in. They split like anyone, can be a payer, and are settled by the owner out of band. They are **data, never principals** - no code path may authenticate as a guest.

### Permissions

**Any member can edit or delete any expense.** The audit trail is the control, not the permission. This is safe only because edit history and undo exist.

### Leaving and closing

- **Leaving is blocked while a balance is non-zero.** Settle, or another member forgives it explicitly (recorded like any settle-up, never a silent write-off).
- This buys a system-wide invariant: **every ledger's balances sum to zero, and every member is a current member.**
- **Archive** requires zero balances. Read-only, reopenable by any member, still searchable and still feeding analytics.
- **Soft-delete everywhere.** Nothing is physically removed.

---

## 5. Money

[Split mechanics](https://github.com/moneytosms/tally/issues/6)

**Integer paise. No floating point in storage, API, or calculation.** INR only.

### Split modes

| Mode | Input |
|---|---|
| Equal | Participant set |
| Exact | Paise per participant, must sum to total |
| Shares | Integer weight per participant |
| Percent | Must sum to 100 |

Shares and percentages **resolve to paise at save time and the resolved amounts are stored** - not recomputed from weights, or editing the participant set silently rewrites history. The mode and its inputs are kept alongside so the editor reopens as the user left it.

### Rules

- **Single payer** per expense. Two people paying one bill is two expenses.
- The payer **need not be a participant**. A guest **can** be the payer.
- **The payer absorbs the rounding remainder.** If the payer isn't a participant, it falls to the first participant in a stable ordering (order of addition, never display order).
- **Excluding someone is leaving them out**, not a zero share. There are no zero-share participants.
- **Refunds are ordinary expenses with a negative total**, split by the same rules and rendered distinctly.

Twelve worked examples covering every rounding and edge case are on [the ticket](https://github.com/moneytosms/tally/issues/6) and should become the implementation's test cases.

---

## 6. Balances and settling

[Balances and debt simplification](https://github.com/moneytosms/tally/issues/8) · [UPI research](https://github.com/moneytosms/tally/issues/4)

### Balances

**One net position per member per ledger**, **derived, never stored**. A cached balance that disagrees with expense history is worse than a slow query.

Who-owes-whom is recoverable from expense history but is not the primary representation.

### Transfer plan

**Minimise transfers, always, as a derived view.** Never persisted, recomputed on every change.

**Every suggested transfer carries a "why?" affordance** expanding to the expense trail. This is a requirement, not a nicety - it is the answer to the one complaint always-on simplification reliably produces.

### Settle-up

No payment callback exists, and P2P collect was abolished on 1 Oct 2025 - settle-up is always payer-push.

- **The payer declares. The payee is notified, not asked.** The balance moves on declaration.
- Optional payee acknowledgement is a nullable timestamp - a tick, never a gate.
- **A settle-up must be recordable without opening a UPI app** - cash, bank transfer, or a guest settled by the owner. The UPI link is convenience on top of a manual record. A missing UPI app is a silent, undetectable no-op, so the manual path must be visible, not hidden.
- **Partial settles are first-class.** Pay ₹500 against a suggested ₹640 and ₹140 remains.

### Cross-ledger

- **Cross-ledger net balance** - one number per person across every shared ledger.
- **Bulk settle** - one UPI link for that total, writing settle-up records into each contributing ledger so every sum-to-zero invariant holds. Guests are skipped (no VPA).

Bulk settle is a multi-ledger write that **must not half-apply** - see §11.

---

## 7. Identity and auth

[Passkey research](https://github.com/moneytosms/tally/issues/5) · [Security model](https://github.com/moneytosms/tally/issues/12)

### Passkeys only

- SimpleWebAuthn. **Multiple credentials per user from day one.**
- **Recovery is owner-initiated re-invite**, and it must **revoke** the lost credential, not merely add one. Recovery codes were rejected: they reintroduce a bearer secret, and friends won't save them but will believe they're covered.
- **In-app browser WebViews have no WebAuthn and fail silently.** Feature-detect before showing the passkey step and offer an explicit "open in your browser" fallback. This will happen on the first invite ever sent.

### Sessions

Long-lived (30 days), sliding, **server-side** in D1 keyed by an opaque token, revocable per device. `HttpOnly; Secure; SameSite=Lax`, host-only. Logout deletes the row.

### Invites

Single-use, 48-hour expiry, revocable. **≥128 bits from a CSPRNG, stored hashed**, bound to one ledger, consumed atomically. Any member may create one.

Invites are also the recovery path, so **a leaked link is potentially account access** - which is why reusable links were rejected.

### Authorisation

Collapses to one rule: **is the caller a current member of this ledger?**

- One Hono middleware, with the ledger id always a path parameter so no handler can forget it.
- **Two exceptions**: ledger deletion is creator-only; admin routes are owner-only.
- **UPI VPA is visible only to ledger co-members.** Serialise profiles through one function taking the viewer as an argument; never spread a user row into a response.

---

## 8. Features

[Feature inventory](https://github.com/moneytosms/tally/issues/2)

### Core
Ledgers · expenses · splits · balances · settle-up · invites · member management

### Parity
Activity feed + comments · categories + notes · search + filter · CSV export · cross-ledger net balance · recurring expenses · push notifications · full edit history + undo

### Self-hosting-native
Natural-language quick add · trip budget + burn rate · bulk settle across ledgers · lifetime personal analytics · clone members on ledger creation · owner admin panel · minimal backup + restore

### Profile
UPI VPA (co-members only) · display name · avatar (generated initials, no image storage) · per-ledger nickname

### Out of scope
Multi-currency · Splitwise import · receipt images · OCR · real payment processing · trip kitty · payment rotation · read-only share links · in-app chat · profile reliability scores · offline-first write sync · public signup · distributable self-hosting

---

## 9. Scheduled work

[Scheduled work](https://github.com/moneytosms/tally/issues/14)

**Push has exactly two triggers, both single-recipient:**

1. Someone settled with you
2. A manual settle reminder ("nudge")

**Deliberately not notifying on split inclusion.** That was the only high-fan-out path, and dropping it means **tally never fans out to more than one recipient** - which removes the CPU ceiling as a live risk.

- **Reminders are manual and rate-limited server-side.** No scheduled sweep.
- **Recurring expenses generate via one alarm per series**, with idempotent catch-up after downtime. Editing a series affects future occurrences only. Archived or deleted ledgers cancel the alarm.
- **Nightly backup to R2**, last N retained. **Restore is a documented command that must be rehearsed once** - an unrehearsed restore path is not a backup.

**Total scheduled work: one alarm per recurring series, plus one nightly backup alarm.** No sweeps, no cron across users.

**iOS:** Web Push requires an installed PWA. Say so where notifications are enabled rather than failing silently.

---

## 10. Interface

[UI shell](https://github.com/moneytosms/tally/issues/11) · [Visual design system](https://github.com/moneytosms/tally/issues/15) · [PWA](https://github.com/moneytosms/tally/issues/16) · [Onboarding](https://github.com/moneytosms/tally/issues/17) · [A11y & i18n](https://github.com/moneytosms/tally/issues/18)

### Navigation

Four bottom tabs plus a persistent FAB for add-expense.

| Tab | Holds |
|---|---|
| Ledgers | Ledger list, positions, burn-rate, recent activity. Default. |
| Balances | Cross-ledger net per friend, bulk settle. |
| Insights | Lifetime analytics, categories, most-spent-with. |
| You | Profile, VPA, devices, notifications, archived ledgers, export, admin panel. |

Balances is deliberately its own tab - "what do I owe Rahul overall" is a different question from "what happened on the Goa trip". **"You" is the pressure valve** that keeps the other three tabs to one job each.

### Add expense

**Natural-language line first, structured form directly beneath - always visible, never behind a toggle.** Target: three taps from cold.

### Visual system

Notion's restraint, Linear's density, on paper, in earth tones. Prototype: `prototypes/design-system.html`.

- **Paper** - warm off-white with moss/ochre radial washes under fractal-noise grain at 5.5%, multiply-blended. One inline SVG, no image assets. Dark mode flips grain to `screen` over warm ink.
- **Green is the ground, not the accent** - moss carries FAB, buttons, active nav, chart fills.
- **Semantic pair is moss / clay**, muted and earthy, **differing in lightness as well as hue** so they survive colour blindness and greyscale. Sign always present; colour is never the only cue.
- **Serif** (`ui-serif, Georgia`) for screen titles and hero amounts - most of the paper feeling, zero webfont weight. **Tabular sans** in lists.
- 7px radius, squircle avatars, **no shadows** except the FAB, **sunken** fields.
- shadcn/ui for Radix primitives, entirely restyled.

Full token table on [the ticket](https://github.com/moneytosms/tally/issues/15).

### PWA

- Precache shell and bundles. **API responses are never cached** - no stale balance can render.
- **Offline shows an explicit state and no numbers at all.** A wrong number about money is worse than no number.
- **Writes offline fail immediately and visibly.** No queue, no outbox, no retry.
- **Updates prompt; never auto-reload** (it would destroy a half-filled expense form). The API must tolerate one version of skew, because people dismiss prompts.
- `display: standalone` - load-bearing, it gates Web Push on iOS. Maskable icon required.
- Install offered **after the first successful action**, never on load. iOS install is manual and its instructions live where notifications are enabled.

### Onboarding

- **Owner**: a single-use bootstrap secret in the Worker environment, burned on use. Then guided: create a ledger → invite people → set VPA.
- **Friend**: display name → passkey → UPI VPA, all up front. **VPA is skippable** and re-prompted at first settle-up.
- **Feature-detect WebView before the passkey step.** Mandatory, not an edge case.
- Empty states carry the teaching.

### Accessibility

**WCAG 2.2 AA on core flows** - add expense, settle up, balances, onboarding. Verified by axe in CI **plus one manual keyboard and screen-reader pass per flow**.

- Amounts are never a bare number - sign and label always.
- The moss/clay pair must pass contrast against both backgrounds and differ in lightness.
- 44×44px tap targets. Dense visuals do not mean dense touch targets.
- `prefers-reduced-motion`, dynamic type survival, live regions for optimistic failures / offline / update prompt.

### i18n

**English only**, but every string goes through `t()` from the first line of frontend code - a plain helper over `locales/<lang>.json` plus native `Intl.PluralRules`. No framework. Adding a language stays a one-file contribution.

`Intl.NumberFormat` with `en-IN` gives ₹1,24,300, which a default formatter gets wrong. Storage stays locale-independent.

---

## 11. Known hazards

Named deliberately. These are where the bugs will be.

1. **Soft-delete filtering.** Every query must exclude deleted rows. Forgetting once produces wrong money. **Enforce structurally** - a default scope in the data-access layer, never left to callers.

2. **D1 has no conventional cross-request transactions.** Two operations must not half-apply:
   - Auto-creating a 1:1 ledger with its first expense
   - Bulk settle writing across several ledgers
   
   Both need batched statements or a Durable Object.

3. **RP ID permanence.** Frozen constant. Any dynamic derivation is a defect.

4. **Backups share a vendor with the data.** Protects against corruption and bad migrations, **not** against losing the Cloudflare account. Accepted knowingly; CSV export is the manual escape hatch.

5. **Recurring catch-up must be idempotent.** A retry must never double-create.

6. **React bundle size** fights "very fast". Measure before adding anything large; Preact-compat is the escape hatch. Lazy-load Recharts.

---

## 12. Invariants worth testing

- Every ledger's member net positions **sum to zero**
- Every expense's splits **sum to its total**
- Exactly one of `user_id` / `guest_name` is set on a member
- A member with a non-zero balance cannot have `left_at` set
- A ledger with `archived_at` set has all balances at zero

---

## 13. Still undecided

Not blockers, but nobody has done this work:

- **The natural-language parser's grammar.** It's in v1 and the UI leads with it, but the accepted syntax, name resolution, ambiguity handling, and whether it supports shares were never specified.
- **The default category set.** Categories feed every chart; the list was never picked.

Deferred facts, not decisions:

- The **RP ID string** - after the Cloudflare account exists
- The **bootstrap secret** - generated at first deploy
- **Restore rehearsal** - before backup counts as done

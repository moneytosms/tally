# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the friend group (~20 people).** Indian, paying in INR, on their phones. Main job happens in the moment: someone just paid (restaurant, cab, trip booking) and logs it before the moment passes; settling happens later from the same phone, usually by handing off to a UPI app. Desktop (768px+ rail layout) is secondary.
- **The owner.** Runs the single instance, invites people, manages guests, uses the admin panel.
- **Portfolio viewers.** Recruiters and developers who meet tally through demo mode and the README. Their first impression matters, but they evaluate the real product, not a marketing layer.
- **Other self-hosters.** Developers who may fork and deploy their own instance.

## Product Purpose

Track shared expenses inside a friend group and settle up without arguments. Records who owes what; never moves money. Success: anyone can log an expense in about three taps from cold, and anyone can look at a balance and believe it, because the app can show exactly how it got there.

## Positioning

- **Explainable balances.** Every net position and every suggested transfer can show its working: per-member paid / share / net that reconciles to the ledger total. Trust comes from showing the arithmetic, not asking for faith.
- **Self-hosted, $0, no ads.** Owned and run by one friend on Cloudflare's free tier. No company, no paywall, no tracking, no upsell.
- **UPI-native settling.** INR only, integer paise, `en-IN` grouping (₹1,24,300), settle via `upi://` deep link.

## Operating Context

- Installed PWA on phones (`display: standalone`, gates Web Push on iOS). Also used in a browser tab; demo mode for visitors.
- Online-only with optimistic UI. Offline shows an explicit state and no numbers. Writes offline fail immediately and visibly.
- Settling hands off to the user's UPI app (GPay, PhonePe, etc.) and returns to tally to declare the payment.
- Ledgers cover trips (end date, budget, burn rate), flatshares, long-running groups, and one-to-ones.
- Push notifications only for the two things worth interrupting someone about.

## Capabilities and Constraints

- Terminology is fixed by `CONTEXT.md` (Ledger, Member, User, Guest, Expense, Payer, Participant, Split, Split mode, ...). Never "group".
- Split modes: equal, exact, shares, percent. Negative totals are refunds. Any member can edit any expense; edits are recorded and undoable.
- Balances per ledger and cross-ledger per friend; bulk settle across shared ledgers; partial settles first-class.
- Guests, recurring expenses, categories, notes, search/filter, comments, insights/analytics, CSV export, trip budgets.
- Auth: email+password or passkey on the same account, invite-only (ADR 0006). No public signup.
- Non-negotiables (from `CLAUDE.md`): integer paise; never a bare amount (sign and label, colour never the only cue); balances derived, never cached; API responses never cached by the service worker; every string through `t()`; guests are data, never principals.
- Explicitly out of scope: multi-currency, receipt images/OCR, real payment processing, in-app chat, offline write sync, public signup.
- **Open tension:** SPEC §1 says distributable self-hosting is not a feature, yet other self-hosters are a confirmed audience. Unresolved whether fork/deploy gets first-class docs or tooling.

## Brand Commitments

- Name: **tally**, lowercase.
- Voice: plain, direct, specific. Action-specific labels ("Delete expense", never "OK"). Net positions state direction in words ("You owe", "You are owed", "Asha owes").
- English only, behind `t()`.
- Existing assets: `public/icon-*.svg|png` (incl. maskable), `assets/readme/hero.svg`, `assets/readme/architecture.svg`.

## Evidence on Hand

- Demo mode with seeded data (demo ledger reconciles to ₹34,100.00).
- README with hero and architecture SVGs.
- 500+ tests over real SQLite; invariants in `docs/SPEC.md` §12 and the twelve worked split examples on issue #6.
- No testimonials, user counts, or usage metrics exist. Do not fabricate any.
- Push delivery is untested on a real device; do not claim it works.

## Product Principles

1. **A wrong number is worse than no number.** Prefer an explicit empty, offline, or error state over anything stale or guessed.
2. **Show the working.** Every balance and transfer can explain itself; trust is earned through arithmetic the user can check.
3. **Fast in the moment.** Logging an expense right after paying beats every other flow; three taps from cold.
4. **Ledger, not bank.** tally records debts and hands off to UPI; it never holds, moves, or pretends to move money.
5. **Owned by a friend.** No growth mechanics, no upsell, no tracking; it should feel like something a friend built for friends.

## Accessibility & Inclusion

- WCAG 2.2 AA on core flows (add expense, settle up, balances, onboarding); axe plus one manual keyboard and screen-reader pass per flow.
- Owed/owe pair must pass contrast on both themes and differ in lightness, not just hue; sign always present.
- 44×44px tap targets regardless of visual density.
- Respect `prefers-reduced-motion`; survive dynamic type; live regions for optimistic failures, offline, and update prompt.

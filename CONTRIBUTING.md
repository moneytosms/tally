# Contributing

tally is MIT licensed (see [LICENSE](LICENSE)). It uses pnpm.

## Setup

```bash
pnpm install
pnpm dev            # vite + wrangler dev
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format         # prettier --check; pnpm format:write to apply
```

Database changes: `pnpm db:generate` writes a migration with drizzle-kit, and `pnpm db:migrate` applies it to the local D1.

## Non-negotiables

Violating any of these is a defect, not a style choice.

- Money is integer paise. No float in storage, API or calculation.
- Never render a bare amount. Sign and label always. Colour is never the only cue.
- The RP ID is a frozen constant. Never derive it from `location.hostname`.
- Soft-delete filtering lives in the data-access layer, never in callers.
- Balances are derived. Never store or cache them.
- Store resolved splits. Never recompute them from weights.
- Every user-facing string goes through `t()`.
- Never cache API responses in the service worker.
- Guests are data, never principals. No code path authenticates as a guest.

Full rationale is in [CLAUDE.md](CLAUDE.md) and [docs/adr/](docs/adr/).

## Terms

Use the words in [CONTEXT.md](CONTEXT.md). A set of members is a **Ledger**, never a group. A member's amount owed or owing in one ledger is a **net position**, not a balance. If you need a concept the glossary does not have, add it there.

## Tests

- Amounts in tests are integer paise. Put the rupee value in a comment:

  ```ts
  const dinner = 192000; // ₹1,920.00
  ```

- Tests assert the invariants in [docs/SPEC.md](docs/SPEC.md) §12 and the twelve worked split examples on issue #6.
- Tests run against real SQLite behind the D1 interface.

## Conventions

- Prefer a database constraint over app-level validation where SQLite allows it.
- No new dependency for something a few lines cover.
- Lazy-load anything large. Measure the bundle before adding a dependency.
- A recurring job must be idempotent. A retry must never create a duplicate.
- Contradicting an ADR is allowed. Doing it silently is not. Say so in the change.

## Commits and branches

- Commit messages are conventional: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Use the imperative mood, at most 72 characters, and no full stop.
- Branch names are lowercase and hyphenated, for example `feat/auth-refresh`.

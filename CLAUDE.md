# tally

Self-hosted expense splitting for friend groups. PWA. One instance, ~20 users, $0/mo.

## Read first

- `CONTEXT.md` - ubiquitous language. Use these terms; don't invent synonyms.
- `docs/SPEC.md` - the buildable v1 spec.
- `docs/adr/` - irreversible decisions and why. Contradicting one is allowed; doing it silently is not.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Stack

TS everywhere. Cloudflare Workers + D1 + Drizzle + Hono. React SPA on Vite, TanStack Query, React Router. Zod shared client/server. Tailwind + shadcn/ui (restyled). SimpleWebAuthn. `vite-plugin-pwa`. Durable Object Alarms.

One Worker serves static assets and `/api/*`. One origin, no CORS.

**RTK wrappers:** `rtk pnpm` (dev/build/db:generate/db:migrate/deploy — all pnpm scripts), `rtk tsc` (typecheck), `rtk vitest` (test). No eslint/prettier config present yet — add `rtk lint`/`rtk format` if those land.

## Canary

Every completed task ends with: `[Canary:tally:TASK_NAME]`. Can't produce it → context dropped, stop and say so.

## Context rules

- Flag before any phase that risks a full context window.
- Running low → `/checkpoint`, then stop.
- All commands must work headless.

## Error protocol

- **Minor** (typo, wrong flag): note inline, continue.
- **Major** (wrong architecture, repeated mistake):
  1. Append to `.claude/errors.md`
  2. Pattern repeats → add a skill under `.claude/skills/`
  3. Approach changes → append to **Learned rules** below

## Agents

Ask before spawning; pick model by task weight. Defined in `.claude/agents/`:
`ReadOnly` · `BuildValidator` · `CodeReviewer` · `LogAnalyzer` · `Researcher` · `DocWriter`

Subagent/hook output follows `.claude/rules/agent-output-conventions.md` — no silent truncation, explicit empty states, end with a concrete next command.

## Learned rules

<!-- Append here on major errors. Do not delete. -->

## Non-negotiables

Violating any of these is a defect, not a style choice.

- **Money is integer paise.** No float in storage, API, or calculation. Ever.
- **Never render a bare amount.** Sign and label always - colour is never the only cue for owed/owe.
- **RP ID is a frozen constant.** Never derive it from `location.hostname`.
- **Filter soft-deleted rows structurally**, in the data-access layer. Never leave it to callers.
- **Balances are derived**, never stored or cached.
- **Store resolved splits**, never recompute from weights.
- **Every user-facing string goes through `t()`.** English only, but the layer ships from line one.
- **Never cache API responses in the service worker.** A stale balance is worse than no balance.
- **Guests are data, never principals.** No code path authenticates as a guest.

## Watch items

- **D1 has no cross-request transactions.** 1:1 ledger auto-create and bulk settle must not half-apply - batched statements or a Durable Object.
- **10 ms CPU ceiling per Worker invocation.** Push is single-recipient by design; keep it that way.
- **Bundle size** fights "very fast". Lazy-load Recharts. Measure before adding anything large.
- **Recurring catch-up must be idempotent.** A retry must never double-create.

## Conventions

- Tests assert the invariants in `docs/SPEC.md` §12 and the twelve worked split examples on issue #6.
- Amounts in tests are paise, written as integers with a comment giving the rupee value.
- Prefer a DB constraint over app-level validation where SQLite allows it.
- No new dependency for what a few lines cover.

## Commands

```bash
pnpm dev            # vite + wrangler dev
pnpm build          # build client + worker
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate     # apply migrations to D1
pnpm deploy         # wrangler deploy
```

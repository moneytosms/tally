# 1. Cloudflare Workers + D1, one deployable

Date: 2026-08-11 · Status: accepted

## Context

tally must run at $0/month, support WebAuthn (which needs a stable HTTPS origin), keep a database that survives redeploys, and feel instant on a phone under optimistic UI.

A survey of current free tiers found most unusable: Fly.io has no free tier for new customers, Render deletes free Postgres after 30 days, Railway's free plan is $1/mo of credit, Deno Deploy Classic shut down 2026-07-20, Netlify moved to a credit model, Vercel Hobby limits crons to once daily with no first-party free DB. Supabase, Turso, and Neon all carry idle penalties.

## Decision

Cloudflare Workers + D1, with Durable Object Alarms for scheduling and static assets served from the same Worker as the API.

A single deployable serving both the SPA and `/api/*`.

Rendering is SPA + JSON API, not SSR.

## Consequences

- Only free option with no cold start, a genuinely persistent free DB, a stable HTTPS origin without buying a domain, and a real scheduler.
- One origin means **no CORS** — a security property, not just convenience.
- SSR was rejected because the 10 ms CPU ceiling per invocation is the binding constraint and SSR spends it on every navigation.
- **D1 has no conventional cross-request transactions.** Auto-creating a 1:1 ledger with its first expense, and bulk settle across ledgers, both need batched statements or a Durable Object.
- Deno Deploy is the documented fallback if the CPU ceiling ever bites; its CPU is pooled rather than per-invocation.

Full research: `docs/research/hosting.md`.

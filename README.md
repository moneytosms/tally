# tally

Self-hosted expense splitting for friend groups. PWA.

One instance, ~20 people, $0/month. Tracks who owes what and hands you a UPI link to settle.
It never touches your money.

## Status

Spec complete, nothing built yet. The scaffold is empty shells.

- **[`docs/SPEC.md`](docs/SPEC.md)** — the buildable v1 spec
- **[`CONTEXT.md`](CONTEXT.md)** — domain language
- **[`docs/adr/`](docs/adr/)** — irreversible decisions and why
- **[`docs/research/`](docs/research/)** — hosting, UPI deep links, passkeys
- **[`prototypes/design-system.html`](prototypes/design-system.html)** — visual direction
- **[Wayfinder map](https://github.com/moneytosms/tally/issues/1)** — every decision, with reasoning

## Stack

Cloudflare Workers + D1 + Drizzle + Hono · React SPA on Vite · TanStack Query · Zod · Tailwind + shadcn/ui · SimpleWebAuthn · Durable Object Alarms.

## Before writing auth code

The deployed host becomes the **permanent WebAuthn RP ID**. Changing it later destroys every
passkey with no migration path. See [ADR 0002](docs/adr/0002-rp-id-is-permanent.md).

# 2. The RP ID is permanent and load-bearing

Date: 2026-08-11 · Status: accepted

## Context

Auth is passkeys only — no passwords, no email, no SMTP. WebAuthn credentials are scoped to a Relying Party ID. **Changing the RP ID destroys every passkey with no migration path**, forcing all users to re-enrol.

`workers.dev` is on the Public Suffix List, so `tally.<account>.workers.dev` is a valid RP ID, and PSL membership blocks sibling Workers apps from claiming it.

## Decision

Ship on the platform subdomain. The RP ID is that full host, permanently.

Serve `/.well-known/webauthn` from the first deploy, listing permitted origins (Related Origin Requests).

## Consequences

- **The Cloudflare account is now permanent infrastructure.** Deleting or renaming it destroys every passkey.
- The RP ID is a **frozen constant in one module**. Any code deriving it from `location.hostname` is a defect.
- The `.well-known` file ships in v1, not later — its entire value is having been there first. It makes adopting a custom domain later possible with **no re-enrolment**.
- A custom domain was rejected: it breaks the $0 rule and converts a one-time decision into a recurring renewal obligation, where a lapse is exactly as catastrophic as a change.

Full research: `docs/research/passkeys.md`.

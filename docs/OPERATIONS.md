# Running a tally instance

One instance, ~20 people, $0/month on Cloudflare's free tier.

---

> **First deploy?** [DEPLOYMENT.md](DEPLOYMENT.md) is the exact step-by-step
> runbook with the full secret checklist. This document is day-2: backups,
> limits, recovery.

## First-time provisioning

`scripts/setup-cloudflare.sh` walks the whole thing. It is interactive and it
freezes one irreversible decision, so read stage 4 before pressing enter.

```bash
./scripts/setup-cloudflare.sh
```

It will:

1. log you into Cloudflare and read back your account id
2. establish your `workers.dev` subdomain
3. **freeze the Worker name and therefore the WebAuthn RP ID** — irreversible
4. create the D1 database
5. create the R2 bucket (optional; see [Backups](#backups))
6. print the bindings to paste into `wrangler.jsonc`
7. generate a VAPID keypair and the owner bootstrap secret
8. deploy, then push the secrets
9. optionally set up a CI deploy token

Everything it generates is also written to `.dev.vars`, which is gitignored.

### The one irreversible step

The Worker name plus your subdomain become the **WebAuthn RP ID**, permanently.
Passkeys are bound to that exact host. If it ever changes, **every passkey on the
instance dies with no migration path** and everyone re-enrols from scratch.

It is frozen in `src/shared/rp-id.ts` and must never be derived from
`location.hostname`. See [ADR 0002](adr/0002-rp-id-is-permanent.md).

The Worker ships `/.well-known/webauthn` from the first deploy, which is what
allows a custom domain to be added *later* without re-enrolling anyone.

### After the wizard

Three values need to reach `wrangler.jsonc`, which ships with them blank:

```jsonc
"d1_databases": [{ ..., "database_id": "<from the wizard, or npx wrangler d1 list>" }],
"vars":         { "VAPID_PUBLIC_KEY": "<from .dev.vars>" }
```

Neither is a secret — the D1 database id is an identifier, and the VAPID public
key is public by design and has to reach the browser for it to subscribe. Commit
both.

The two actual secrets are set separately and never committed:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put BOOTSTRAP_SECRET
```

> **Note:** the provisioning wizard pushes `VAPID_PRIVATE_KEY` and
> `BOOTSTRAP_SECRET` but *not* `VAPID_PUBLIC_KEY`, because a public key does not
> belong in `wrangler secret`. Putting it in `vars` is the step that is easy to
> miss; push notifications will silently stay unavailable without it. The admin
> panel's Instance section shows whether push is configured.

### Claiming the instance

Open `https://<your-worker>.<subdomain>.workers.dev`, enter the bootstrap
secret once, and create your passkey. The secret is burned on use. You are now
the Owner: you hold the admin panel, manage guests, and perform passkey recovery.

Then invite people. Every invite is single-use and expires in 48 hours.

---

## Day-to-day

```bash
pnpm dev            # vite + wrangler dev
pnpm build          # build client + worker
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm db:generate       # drizzle-kit generate — after any schema change
pnpm db:migrate        # apply migrations to LOCAL D1 (pnpm dev)
pnpm db:migrate:remote # apply migrations to PRODUCTION D1
pnpm deploy            # wrangler deploy
```

### Deploying a schema change

```bash
pnpm db:generate     # writes migrations/NNNN_*.sql
# READ the generated SQL before applying it — see the warning below
pnpm test            # the test harness applies every migration; failures show up here
pnpm db:migrate:remote
pnpm deploy
```

> **Check drizzle-kit's output.** When SQLite cannot alter a table in place,
> drizzle-kit emits a create-copy-drop-rename sequence — and it has been observed
> to emit an `INSERT ... SELECT` that reads the *new* columns from the *old*
> table, which fails at apply time. `migrations/0001_numerous_sunspot.sql` carries
> a hand-edit fixing exactly that. Read every generated migration.

Migrations run against the test harness on every `pnpm test`, so a migration that
does not apply cleanly fails the whole suite rather than failing in production.

---

## Backups

**There is currently no automated backup.** R2 provisioning failed during setup
and nightly backups were deliberately deferred rather than half-built.

What exists instead:

- **CSV export** — `/api/export.csv` for everything you are a member of, or
  `/api/ledgers/:id/export.csv` for one ledger. Also in the app under **You →
  Export**. One row per expense split, so it pivots in any spreadsheet. This is
  the manual escape hatch and it does not depend on this instance staying up.
- **`wrangler d1 export`** — a full SQL dump:

  ```bash
  npx wrangler d1 export tally --remote --output tally-$(date +%F).sql
  ```

  Run it on a schedule you actually keep. Restoring is
  `npx wrangler d1 execute tally --remote --file tally-YYYY-MM-DD.sql` against a
  fresh database.

> **Rehearse the restore once.** An unrehearsed restore path is not a backup.
> Create a throwaway D1 database, restore a dump into it, and confirm it opens.

Note the honest limit: backups sharing a vendor with the data protect against
corruption and bad migrations, **not** against losing the Cloudflare account.
That is accepted knowingly, and CSV export is the answer to it.

---

## Operational limits worth knowing

| Limit | Why it matters | Current margin |
|---|---|---|
| 10 ms CPU per Worker invocation | Kills expensive aggregation | Push is single-recipient by design; recurring catch-up is capped at 50 occurrences per run |
| D1 has no cross-request transaction | A half-applied write is wrong money | Every multi-statement write uses `db.batch([...])` |
| Bundle size | Fights "very fast" | Recharts is lazy-loaded; measure before adding anything large |
| Free-tier D1 row reads | ~20 users is nowhere near it | Not a live concern at this scale |

## Recovery scenarios

**Someone lost their phone.** Admin panel → People → revoke the lost passkey.
Then send them a fresh invite to re-enrol. Revoking is the whole recovery path.

**An invite leaked.** Admin panel → Open invites → revoke. An invite is
potentially account access, which is why they are listed and revocable.

**A wrong expense.** Any member may edit or delete any expense — the audit trail
is the control, not the permission ([ADR 0005](adr/0005-any-member-can-edit.md)).
Every edit writes a revision, and undo restores from it. Nothing is ever hard
deleted.

**Push stopped working.** Check the admin panel's Instance section for
`pushConfigured`. The usual cause is `VAPID_PUBLIC_KEY` missing from
`wrangler.jsonc` `vars`. On iOS, web push only works from a Home Screen install —
the app says so where notifications are enabled.

**A recurring expense did not appear.** Catch-up is idempotent and driven by a
Durable Object alarm; it back-fills after downtime. Check that the ledger is not
archived (an archived ledger cancels its series) and that the series is not
paused. A series whose payer has left the ledger skips rather than guessing.

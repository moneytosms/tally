# Deploying tally

Exact runbook, first deploy to live instance. Day-2 operations live in
[OPERATIONS.md](OPERATIONS.md).

Placeholders are written `<LIKE_THIS>`. Substitute; never commit a filled-in
secret.

---

## 0. Before you start

| Need | Check |
|---|---|
| Node 20+ and pnpm 11 | `node --version && pnpm --version` |
| A Cloudflare account (free tier is enough) | - |
| `openssl` | `openssl version` |

```bash
pnpm install
```

### The one irreversible decision

`src/shared/rp-id.ts` freezes the WebAuthn RP ID:

```ts
export const RP_ID = "tally.moneytosms.workers.dev";
export const ORIGIN = "https://tally.moneytosms.workers.dev";
```

That host is `<WORKER_NAME>.<CF_SUBDOMAIN>.workers.dev`. It must match the
`name` in `wrangler.jsonc` and your account's workers.dev subdomain **exactly**.

- Deploying to **this** account (`moneytosms`) with Worker name `tally`: change nothing.
- Deploying anywhere else: edit `src/shared/rp-id.ts` and `wrangler.jsonc`'s
  `name` **now**, before anyone enrols a passkey.

Changing it after enrolment destroys every passkey with no migration path
([ADR 0002](adr/0002-rp-id-is-permanent.md)). It is never derived from
`location.hostname`. The Worker serves `/.well-known/webauthn` from deploy one,
which is what lets a custom domain be added later without re-enrolling anyone.

---

## 1. Authenticate

```bash
npx wrangler login
npx wrangler whoami          # confirm the account id
```

`scripts/setup-cloudflare.sh` walks steps 1–5 interactively and writes
`.dev.vars` for you. The steps below are the same thing done by hand.

---

## 2. Create the D1 database

```bash
npx wrangler d1 create tally
```

Copy the printed `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "tally",
    "database_id": "<D1_DATABASE_ID>", "migrations_dir": "migrations" }
]
```

Not a secret. It is meant to be committed. Recover it later with
`npx wrangler d1 list`.

---

## 3. Generate the secrets

```bash
npx web-push generate-vapid-keys      # -> VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
openssl rand -base64 32               # -> BOOTSTRAP_SECRET
```

Write all three to `.dev.vars` (gitignored) so local dev matches production -
`cp .dev.vars.example .dev.vars` and fill it in.

### What each value is

| Value | Secret? | Where it goes | What breaks without it |
|---|---|---|---|
| `<D1_DATABASE_ID>` | No | `wrangler.jsonc` → `d1_databases` | Deploy fails |
| `<VAPID_PUBLIC_KEY>` | No - browser needs it to subscribe | `wrangler.jsonc` → `vars` | Push silently stays off |
| `<VAPID_PRIVATE_KEY>` | **Yes** | `wrangler secret` | Push silently stays off |
| `<BOOTSTRAP_SECRET>` | **Yes** | `wrangler secret` | Nobody can claim the instance, and **nobody can log in** |

`BOOTSTRAP_SECRET` is not only the one-time claim code. It also signs the
short-lived WebAuthn challenge cookie on **every** registration and login
(`src/server/auth/webauthn.ts`). It must stay set permanently. Rotating it is
safe for passkeys but invalidates any login in flight at that moment.

Both VAPID keys are optional: with them unset, push degrades to off rather than
throwing (SPEC §9). Everything else works.

---

## 4. Put the non-secrets in `wrangler.jsonc`

```jsonc
"vars": {
  "VAPID_PUBLIC_KEY": "<VAPID_PUBLIC_KEY>"
}
```

Commit `wrangler.jsonc` with `database_id` and `VAPID_PUBLIC_KEY` filled in.
This is the step most often missed - the public key must reach the browser, and
`wrangler secret` will not deliver it.

The `RECURRING` Durable Object binding and its `v1` migration tag are already in
the file. Leave both alone.

---

## 5. Deploy the Worker

Secrets can only attach to a Worker that already exists, so deploy first.

```bash
pnpm typecheck && pnpm test
pnpm deploy                  # = pnpm build && wrangler deploy
```

`https://<WORKER_NAME>.<CF_SUBDOMAIN>.workers.dev` is now live and 500s on
anything touching the database. That is expected - migrations come next.

---

## 6. Push the secrets

```bash
npx wrangler secret put VAPID_PRIVATE_KEY     # paste <VAPID_PRIVATE_KEY>
npx wrangler secret put BOOTSTRAP_SECRET      # paste <BOOTSTRAP_SECRET>
npx wrangler secret list                      # both listed, values never shown
```

---

## 7. Apply migrations to remote D1

```bash
pnpm db:migrate:remote        # wrangler d1 migrations apply tally --remote
```

`pnpm db:migrate` is the **local** D1 used by `pnpm dev`. It does not touch
production. Migrations also run against the test harness on every `pnpm test`,
so a migration that cannot apply fails the suite before it reaches here.

Verify:

```bash
npx wrangler d1 execute tally --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

---

## 8. Claim the instance

1. Open `https://<WORKER_NAME>.<CF_SUBDOMAIN>.workers.dev`
2. Enter `<BOOTSTRAP_SECRET>` once
3. Create your passkey

The claim is burned on use - a second attempt is rejected regardless of the
secret. You are now the Owner: admin panel, guest management, passkey recovery.

Then invite people. Every invite is single-use and expires in 48 hours.

---

## 9. Verify the deploy

| Check | How | Expect |
|---|---|---|
| RP ID matches host | `curl https://<WORKER_NAME>.<CF_SUBDOMAIN>.workers.dev/.well-known/webauthn` | the exact live origin |
| Push configured | Admin panel → Instance | `pushConfigured: true` |
| Passkey login | Log out, log back in | no re-enrol prompt |
| Recurring alarm | Create a daily series, check it fires | occurrence appears once, never twice |
| Export works | **You → Export** | CSV downloads, one row per split |
| Install as PWA | Add to Home Screen | offline shell loads, balances do not |

iOS: web push only works from a Home Screen install. The app says so where
notifications are enabled.

---

## 10. Redeploying

```bash
pnpm typecheck && pnpm test
pnpm deploy
```

Schema changed as well:

```bash
pnpm db:generate              # read the generated SQL - see OPERATIONS.md
pnpm test
pnpm db:migrate:remote
pnpm deploy
```

Secrets and `vars` survive a redeploy. Re-run `wrangler secret put` only to
rotate a value.

---

## Secret checklist

Copy these to your password manager after provisioning. Only the two marked
secret ever need protecting; the rest are recoverable from Cloudflare.

```
CF_ACCOUNT_ID       = <CF_ACCOUNT_ID>        # npx wrangler whoami
CF_SUBDOMAIN        = <CF_SUBDOMAIN>         # the workers.dev prefix
WORKER_NAME         = <WORKER_NAME>          # frozen - part of the RP ID
D1_DATABASE_ID      = <D1_DATABASE_ID>       # npx wrangler d1 list
VAPID_PUBLIC_KEY    = <VAPID_PUBLIC_KEY>     # public by design
VAPID_PRIVATE_KEY   = <VAPID_PRIVATE_KEY>    # SECRET - unrecoverable, regenerating resets every push subscription
BOOTSTRAP_SECRET    = <BOOTSTRAP_SECRET>     # SECRET - also signs login challenge cookies
CLOUDFLARE_API_TOKEN= <CLOUDFLARE_API_TOKEN> # SECRET - only if you deploy from CI
```

Regenerating `VAPID_PRIVATE_KEY` invalidates every existing push subscription;
everyone re-enables notifications. It does not affect passkeys or data.

---

## Optional: deploy from CI

Only needed if you want pushes to `main` to deploy. Create a Cloudflare API
token with **Edit Cloudflare Workers**, then:

```bash
gh secret set CLOUDFLARE_API_TOKEN     # paste <CLOUDFLARE_API_TOKEN>
gh secret set CLOUDFLARE_ACCOUNT_ID    # paste <CF_ACCOUNT_ID>
```

No workflow ships in this repo. Local `pnpm deploy` is the supported path.

---

## Known gaps at v1

- **No automated backups.** R2 is deliberately unconfigured. CSV export and
  `wrangler d1 export` are the escape hatches - see
  [OPERATIONS.md → Backups](OPERATIONS.md#backups). Rehearse a restore once.
- **No staging environment.** One instance, ~20 people. `pnpm dev` against local
  D1 is the rehearsal.
- **No CI.** `pnpm typecheck && pnpm test` before `pnpm deploy` is the gate, and
  it is manual.

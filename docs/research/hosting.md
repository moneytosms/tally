# $0/mo hosting for tally

**Question:** which genuinely-free hosting setup can run tally — self-hosted expense splitting, ~20 users, online-only PWA with optimistic UI, WebAuthn/passkeys, persistent DB holding thousands of expense rows for years.

**Sources checked:** 2026-08-11, provider docs/pricing pages only (links inline). Free tiers move fast — re-verify before committing.

**Constraints assumed locked:**

- $0/mo hard, free tiers only.
- WebAuthn/passkeys: stable HTTPS origin + fixed RP ID.
- DB survives redeploys; thousands of rows over years; no data loss.
- Online-only PWA with optimistic UI — backend latency and cold starts are felt on every tap.
- **Web Push notifications** (v1): VAPID keypair + push subscriptions stored server-side, outbound HTTPS to arbitrary FCM/APNs/Mozilla endpoints.
- **Recurring expenses + settle-up reminders** (v1): real scheduled execution, or a documented lazy-materialise-on-read substitute.
- ~20 users, a few ledgers. Stack undecided.
- Multi-currency is **out** of scope — no external FX API dependency.

---

## Headline findings

1. **Fly.io is out.** "Fly.io no longer offers plans to new customers." No free allowance for new signups; smallest machine ~$2.02/mo, volumes $0.15/GB/mo. The 3×256MB free VMs only survive for orgs on legacy Hobby/Launch/Scale plans. ([fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/))
2. **Render's free Postgres is not persistent.** Free databases "expire 30 days after creation", then a 14-day grace period, then Render "deletes the database (along with all of its data)". Disqualifying on its own.
3. **Railway's free tier is nominal.** Free plan is $0/mo with **$1 of credit per month**; Trial is a one-time $5 grant. $1/mo does not run an always-on container.
4. **Deno Deploy Classic is dead.** "Deno Deploy Classic (dash.deno.com) and the subhosting v1 API will be shut down on **July 20, 2026**" — already past. Only the new Deploy exists.
5. **Netlify moved to credits.** Free is a "300 credit limit"/mo, with bandwidth at "20 credits per GB" and production deploys at "15 credits" each — i.e. ~15 GB bandwidth *or* ~20 deploys, shared.
6. **PlanetScale still has no free tier** (Hobby removed April 2024, not reinstated). **Koyeb** has reportedly closed its free Starter tier to new signups post-acquisition. Both secondary-sourced; treat as "don't plan around it".
7. **Cloudflare quietly got better.** Durable Objects with the **SQLite backend are now available on the Workers Free plan** — 5 GB storage, 13,000 GB-s/day compute, and **DO Alarms**, which is a free per-entity scheduler. That was paid-only not long ago.
8. **Vercel Hobby cannot do reminders.** "Hobby accounts are limited to cron jobs that run **once per day**", with "Per-hour (±59 min)" precision — a cron set for 1am fires "anywhere between 1:00 am and 1:59 am". ([cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing))

---

## Comparison

Scheduler column is scored: ✅ real scheduler on free · ⚠️ present but crippled · ❌ none.

| Provider | Free tier now | Cold start | Persistent free DB | Caps | Domain / HTTPS | **Scheduled work (free)** | **Web Push viable** | When it stops being free |
|---|---|---|---|---|---|---|---|---|
| **CF Workers + D1** | 100k req/day, 10 ms CPU/req, 128 MB, 50 subrequests/req | ~none (isolates) | **Yes** — D1, no expiry, no idle deletion | D1: 5 GB, 5M rows read/day, 100k written/day | `*.workers.dev` free & stable; custom domain needs the zone on Cloudflare (domain costs money) | ✅ **5 cron triggers/account**, 15 min wall clock, but **10 ms CPU per cron invocation** and 50 subrequests | ✅ `fetch()` to any host; encrypted Worker Secrets for VAPID private key; WebCrypto has ECDH/HKDF/AES-GCM/ES256 | Daily req cap → Error 1027; D1 row cap → API errors; storage full → writes blocked. No card. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/pricing/)) |
| **CF Durable Objects (SQLite)** | On free plan; 100k DO req/day, 13,000 GB-s/day, 5 GB SQLite | ~none | **Yes** (SQLite backend only; KV backend is paid) | 5M rows read / 100k written per day | as above | ✅✅ **DO Alarms** — per-object scheduled wake-ups, 15 min cap. Sidesteps the 5-cron and per-cron-CPU limits by fanning out | ✅ same as Workers | "If you exceed any one of the free tier limits, further operations of that type will fail." ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) |
| **Cloudflare Pages** | 500 builds/mo, 1 concurrent, 20k files, 25 MiB/file, 100 domains/project | n/a (static) | none | 100 projects/account | Yes, free TLS | via Workers | via Workers | Build cap only. ([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)) |
| **Oracle Always Free** | 4 Arm OCPU / 24 GB across ≤2 A1 VMs (1,500 OCPU-h + 9,000 GB-h/mo), 2 AMD micros, **200 GB block storage**, 10 TB egress/mo, 2 Autonomous DBs | None — real always-on VM | **Yes** — your own Postgres/SQLite on 200 GB | 200 GB; nothing row-based | Yes, BYO domain + Caddy/certbot; **no free hostname provided** | ✅✅ real cron / systemd timers / in-process scheduler, no CPU ceiling | ✅ unrestricted outbound, secrets on disk | **Idle reclamation:** reclaimed if over 7 days the 95th-pct CPU <20%, network <20% (and memory <20% on A1). Card required. A1 capacity errors common. ([Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)) |
| **Fly.io** | **None for new customers** | n/a | n/a | n/a | Yes | n/a | n/a | Immediately — PAYG from first machine (~$2.02/mo min). ([pricing](https://fly.io/docs/about/pricing/)) |
| **Vercel Hobby** | 1M invocations, 4 CPU-hrs, 360 GB-hrs memory, 1M edge req, 100 deploys/day, 300s max fn duration | Fluid compute; small but non-zero | **No** — Hobby storage is Blob only; Postgres is a Neon marketplace integration | see left | Yes, free TLS | ⚠️ **once per day max, ±59 min precision.** Fine for recurring-expense materialisation, **useless for timely reminders** | ✅ outbound fetch + env secrets | Exceeding a limit **pauses the feature for 30 days**. Hobby is non-commercial personal use only (fine for tally). ([Hobby](https://vercel.com/docs/plans/hobby)) |
| **Netlify Free** | 300 credits/mo (deploys 15 credits each, bandwidth 20 credits/GB), functions, Netlify Database (Neon), Blobs | Function cold starts | Via Netlify Database (Neon) — inherits Neon's limits incl. scale-to-zero | ~15 GB bandwidth-equivalent if you spend nothing else | Yes, free SSL | ✅ **Scheduled functions "available on all pricing plans"**, cron syntax, **30 s execution limit**; each run burns credits | ✅ outbound fetch + env secrets | Credits exhausted → behaviour not documented on the pricing page. ([pricing](https://www.netlify.com/pricing/), [scheduled fns](https://docs.netlify.com/build/functions/scheduled-functions/)) |
| **Railway** | Free plan $0/mo with **$1 credit/mo**; Trial = one-time $5 | n/a | Volume persists; the credit doesn't | $1/mo ≈ a few hours of a small container | Yes | ✅ in principle (always-on process) — ❌ in practice, no credit to run it | ✅ | Credit exhausted → deploys stop; can't buy credit without upgrading. ([plans](https://docs.railway.com/reference/pricing/plans)) |
| **Render Free** | 750 instance-hours/mo per workspace, custom domains, managed TLS | **Sleeps after 15 min idle; spin-up "takes about one minute"** | **No** — free Postgres "expire[s] 30 days after creation", +14-day grace, then deleted | Free PG 1 GB, one per workspace; filesystem ephemeral | Yes, managed TLS free | ❌ **Cron Jobs are not in the free offering list**, and the web service sleeps, so no in-process scheduler either. Lazy-on-read is the only option — and it pays the ~60 s cold start | ✅ outbound works while awake | 30-day DB expiry; 15-min sleep. ([render.com/docs/free](https://render.com/docs/free)) |
| **Deno Deploy (new)** | 1M req/mo, 20 GB egress, 15 h CPU-time, 350 GB-h memory, 20 active deployments, 50 domains/org, 1 GiB volume, **1 GiB KV** (450k read / 300k write units per mo) | Low (V8 isolates) | KV + volume, free | see left | Yes, `*.deno.dev` + custom domains | ✅ **`Deno.cron()`, 10 cron jobs per revision on free**, minute granularity, no-overlap guarantee, `backoffSchedule` retries. No per-invocation CPU cliff — CPU is pooled (15 h/mo) | ✅ outbound fetch + env secrets; WebCrypto available | Free orgs exceeding requests/bandwidth/CPU are **paused until next cycle**. Classic shut down 2026-07-20. ([pricing](https://deno.com/deploy/pricing), [cron](https://docs.deno.com/deploy/reference/cron/)) |
| **Supabase Free** | 500 MB DB, 5 GB egress + 5 GB cached, 50k MAU auth, 2 active projects | Warm while active; unpausing is slow and manual | Yes, while active | 500 MB DB / 500 MB RAM shared CPU | stable `*.supabase.co` host | ⚠️ `pg_cron` + Edge Function schedules exist, but **a paused project runs no crons at all** | ✅ Edge Functions outbound; `pg_net` from SQL; Vault for secrets | **Projects paused after 1 week of inactivity**, manual restore. ([pricing](https://supabase.com/pricing)) |
| **Neon Free** | 0.5 GB storage/project, 100 CU-hours/project/mo (≈400 h at 0.25 CU), 100 projects, 10 branches/project | **Scale-to-zero after 5 min, cannot be disabled** — first query pays a resume | 0.5 GB/project | Autoscale ≤2 CU | n/a (DB only) | ❌ DB only — no scheduler, no outbound | ❌ needs a separate compute tier | Caps → operations fail; no documented deletion of idle free projects. ([plans](https://neon.com/docs/introduction/plans)) |
| **Turso Free** | 100 databases, 5 GB storage, 500M rows read/mo, 10M written/mo, 3 GB syncs, 1-day PITR, no card | libSQL over HTTP; low | Yes | see left | n/a | ❌ DB only | ❌ needs separate compute | **"Databases get archived after 10 days of inactivity for users on a free plan"**; recover with `turso group unarchive`. ([pricing](https://turso.tech/pricing), [CLI](https://docs.turso.tech/cli/group/unarchive)) |
| **PlanetScale** | No free tier (Hobby removed Apr 2024) | — | — | — | — | — | — | Immediately. *(secondary sources)* |
| **Koyeb** | Free Starter reportedly closed to new signups post-acquisition | — | 2 GB SSD on the old free instance | — | Yes | ✅ if you had it | ✅ | Don't plan around it. *(secondary sources)* |

### Hosts that cannot schedule at all, plainly

- **Render Free** — no free Cron Jobs, and the free web service sleeps at 15 minutes, so there is no long-lived process to host an in-app scheduler. Lazy-on-read is the *only* option, and it is a poor one here: reminders are inherently push-shaped (nobody opens the app to be reminded to open the app), and every first tap after idle eats a ~60 s spin-up.
- **Neon** and **Turso** — databases only. Neither runs your code. They must be paired with a compute host, and then that host's scheduler is what counts.
- **Vercel Hobby** — has a scheduler but it is capped at once per day with ±59 min slop. Lazy-on-read is a viable substitute for **recurring expenses** (materialise missed occurrences when a ledger is opened — idempotent, ordering-independent, and nobody notices the lag). It is **not** a substitute for **settle-up reminders**, which only have value if they fire at a chosen time.
- **Railway Free** — technically capable, practically not: $1/mo of credit buys hours, not a month.

### Web Push: the actual requirement

Web Push needs three things from a host: (1) outbound HTTPS to arbitrary third-party endpoints (`fcm.googleapis.com`, `web.push.apple.com`, `updates.push.services.mozilla.com`, …), (2) a place to keep the VAPID private key that isn't in the repo, and (3) crypto primitives for the payload envelope — ECDH P-256 + HKDF-SHA256 + AES-128-GCM for the body, ECDSA P-256 (ES256) for the VAPID JWT.

Every compute host surveyed does (1) and (2). (3) is the one to check per runtime: all of Workers, Deno Deploy, Vercel, Netlify and any Oracle VM expose these through WebCrypto or a native crypto lib, so no host is disqualified on Web Push alone. Note the happy overlap: **P-256 ECDSA is also what WebAuthn verification needs**, so one crypto surface covers both features.

### Passkey/RP-ID note

`workers.dev`, `pages.dev`, `deno.dev`, `vercel.app`, `netlify.app`, `onrender.com`, `fly.dev` are all on the Public Suffix List. RP ID therefore cannot be the bare platform domain — it must be your full host (`tally.<acct>.workers.dev`). That is fine, and is the safe configuration: credentials are scoped to your subdomain. The cost is that the chosen origin becomes **permanent** — passkeys bind to the RP ID, so moving to a custom domain later invalidates every credential and forces all 20 users to re-enrol. Pick the final origin before the first passkey is registered.

---

## Recommendation

**Cloudflare Workers + D1, with Durable Object Alarms for scheduling, static PWA on Cloudflare Pages, on a `*.workers.dev` origin.**

Why it wins on these specific constraints:

- **Latency / optimistic UI.** Workers are V8 isolates with effectively no cold start. Everything else free either sleeps (Render: 15 min → ~60 s), scales to zero (Neon: 5 min), pauses (Supabase: 1 week), or archives (Turso: 10 days). Only Cloudflare and Deno Deploy never make a tap wait on a resume.
- **Persistence.** D1 is free, no expiry, no idle deletion, 5 GB. Thousands of expense rows is single-digit MB. 100k row-writes/day for 20 users is unreachable.
- **Passkeys.** `tally.<acct>.workers.dev` is a stable HTTPS origin with a fixed RP ID and free TLS, no domain purchase — which matters, because "$0/mo" excludes buying a domain.
- **Scheduling.** Two mechanisms on free: 5 account-wide cron triggers, plus **Durable Object Alarms**, which are the better fit. One DO per ledger (or per user) sets its own alarm; recurring expenses materialise on their own schedule and reminders fire per-recipient. Fan-out sidesteps both the 5-cron cap and the batch-size problem below.
- **Web Push.** Unrestricted `fetch()`, encrypted Worker Secrets for the VAPID key, and WebCrypto covers ECDH/HKDF/AES-GCM/ES256.
- **No card, no expiry, no sleep.** The failure mode is a hard daily cap, not data loss.

**Stack fit:** Workers runs JS/TS natively, plus WASM (Rust, Go via TinyGo, Python via Pyodide). If the stack must be Go/Java/Ruby/.NET server-side, Cloudflare is out and the pick flips to Oracle Always Free.

### The single biggest risk

**The 10 ms CPU-time ceiling on the Workers free plan — which now bites twice, and the second bite is the new one.**

It is CPU time, not wall time, so awaiting D1 or a push endpoint is free. Per-request it is survivable: WebAuthn verification via WebCrypto is sub-millisecond, and there is no password hashing to do because passkeys replaced it. The sharper problem is **scheduled push fan-out**: cron trigger invocations get the same **10 ms CPU** and **50 subrequests**, and each Web Push send costs an ECDH derive + HKDF + AES-GCM encrypt + an ES256 JWT sign. A naive "loop over all subscriptions and send" in one cron tick will run out of CPU before it runs out of users, and it fails silently-ish — the tick dies, and nobody gets reminded.

Mitigation, in order of preference: (1) do the fan-out with **one Durable Object Alarm per recipient** so each send gets its own fresh 10 ms budget — this is the design the platform wants and it removes the ceiling as a scaling factor entirely; (2) keep the Worker a thin API, push settle-up aggregation into D1 SQL rather than JS; (3) never N+1 your D1 queries — 50 subrequests per invocation means 50 queries is a hard wall.

If profiling shows the app genuinely needs more CPU per request, this is not tunable — the fix is $5/mo Workers Paid (50 ms CPU, 1000 subrequests), which breaks the $0 constraint. **That is the decision this design is betting against.**

### Runner-up

**Deno Deploy.** Now a genuinely close second, largely on the scheduling question: `Deno.cron()` gives 10 cron jobs per revision on free with minute granularity, no-overlap guarantees, and built-in retry backoff — a nicer scheduler story than Cloudflare's, and crucially its CPU is **pooled at 15 h/mo rather than capped per invocation**, so the push fan-out problem above simply doesn't exist. It loses on two counts: the store is 1 GiB KV, which is a worse fit than D1's SQL for settle-up aggregation over a ledger; and the platform just shut down its predecessor (Classic, 2026-07-20), which is a stability signal worth weighing for something meant to hold years of data. **If the 10 ms CPU wall turns out to bite, this is where to go.**

**Oracle Cloud Always Free** — a real always-on Arm VM (up to 4 OCPU / 24 GB, 200 GB disk), local Postgres or SQLite, real cron, no CPU-per-request ceiling, any language. The best scheduling and Web Push story of anything surveyed. Rejected because: (a) it needs a credit card *and* a bought domain to get HTTPS at all — no free hostname is provided, so passkeys require a paid domain, breaking $0; (b) the **documented idle-reclamation policy** targets exactly this workload — a 20-user ledger sits far below the 20% CPU/network threshold over any 7-day window; (c) you own patching, backups and TLS renewal forever. Pick it only if the stack can't run on Workers.

### Do not pick

- **Render** — free DB deleted at day 30, ~60 s cold start, and no scheduler on free at all.
- **Railway** — $1/mo of credit.
- **Fly.io** — no free tier for new accounts.
- **Vercel / Netlify alone** — no free persistent DB of their own; you'd bolt on Neon and inherit its 5-minute scale-to-zero on every first tap. Vercel additionally cannot fire a timely reminder on Hobby.

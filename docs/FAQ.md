# Troubleshooting and FAQ

## Passkey sign-in fails inside WhatsApp, Instagram or Messenger

Links opened from those apps show in an in-app browser. On iOS that browser has no WebAuthn support, and the passkey prompt fails without a clear error. Open the link in Safari or Chrome and sign in there. Password sign-in works in the in-app browser, so it can get you in, but add a passkey from a real browser.

## Why does a passkey stop working on another address?

A passkey is bound to the host name the instance was first deployed on, `tally.<account>.workers.dev`. That value is the WebAuthn RP ID. It is a frozen constant (ADR 0002). Opening the app on a custom domain, or on a different `workers.dev` name, cannot use the passkeys already registered. Changing the RP ID destroys every passkey on the instance, and there is no migration path. Keep the Worker name you chose on the first deploy. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Why is there no multi-currency?

It is out of scope for v1. Every amount is an integer count of paise in INR only (ADR 0003), and the currency is a constant. Multi-currency was considered and rejected.

## Why can I not add an expense while offline?

Writes made offline fail at once and show the failure. There is no queue, no outbox and no retry, so nothing can be saved later by surprise. Offline, tally also hides every amount. A wrong number about money is worse than no number.

## Does tally move money?

No. It never touches your money. **Pay with UPI** opens your UPI app with the payee, amount and note filled in, and you pay there. tally records a settlement only when you tap **Record settlement**. It does not check that the payment went through.

## Why does the demo reset when I refresh?

The demo runs in the browser tab against sample data held in memory. Nothing is saved and nothing leaves the tab. A refresh loads the sample data again. Balances in the demo are calculated by the same code the server uses.

## Are push notifications working?

They are built, but they have not been tested on a real phone. Push delivery has not been verified on any device. Two kinds are sent: someone settles with you, and a settle reminder. If a notification does not arrive, check the admin panel's **Instance** section for `pushConfigured`. The usual cause is a missing `VAPID_PUBLIC_KEY` in the `vars` of `wrangler.jsonc`. On iPhone and iPad, push only works after the app is installed to the Home Screen.

## What are the Cloudflare limits that matter here?

The repo does not list the free-tier quotas, so check Cloudflare's current pricing page for those numbers. The limits that shape the code are these:

- **10 ms of CPU per Worker invocation.** This is why aggregation is kept small, push sends one recipient at a time, and recurring catch-up runs at most 50 occurrences per run.
- **Password hashing.** The 600k-iteration PBKDF2 pass runs in the browser. The Worker runs only a 10k pass over the result, which keeps sign-in inside the CPU limit.
- **D1 has no transactions across requests.** Every multi-statement write is sent as one `db.batch`, so a write cannot half-apply.
- **Row reads.** About 20 people is far below the free-tier D1 row-read quota, so this is not a live concern at this scale.

## What if someone loses their phone?

The owner opens the admin panel, goes to **People**, and taps **Issue recovery link**. The link is single use and expires in one hour. It re-enrols the same account on the new device, so history stays attached. Once they are signed in, revoke the lost passkey. Revoking a user's last passkey is refused, so issue the recovery link first.

## Why do I need an invite to sign up?

There is no public signup. An invite is the only way an account is created (ADR 0006). Ledger invites are single use, last 48 hours, and are bearer credentials, so a leaked one can give account access. The owner can revoke open invites in the admin panel under **Open invites**.

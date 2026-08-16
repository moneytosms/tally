# 0006 - Passwords sit alongside passkeys, and invites can be instance-wide

Status: accepted
Date: 2026-08-16

## Context

v1 shipped passkey-only, invite-only, with every invite bound to exactly one
ledger. That is the strongest of the options and it is also the reason nobody
joined: onboarding a friend meant them owning a device with a working platform
authenticator, in a browser that is not an in-app WebView, on the first try. The
failure mode is silent and the recovery path is the owner issuing a token by
hand.

The instance still has ~20 users and one operator. The threat model has not
changed; the tolerance for enrolment friction has.

## Decision

**Two credential kinds, one account.** A user row may carry an email and a
PBKDF2 password hash, any number of passkeys, or both. Either signs you in. The
passkey path is unchanged - `RP_ID` stays frozen (ADR 0002), the ceremony code is
untouched, and adding a passkey to a password account is the same
`register/options` call it always was.

**Passwords are PBKDF2-SHA256 via WebCrypto**, not bcrypt or argon2. workerd has
no native either, and a WASM hasher is a large dependency for twenty people. The
iteration count is stored inside the hash string so the cost can be raised later
without invalidating the passwords already on the instance.

**The expensive half of the KDF runs in the browser.** The instance is on the
Workers free plan: ~10ms of CPU per invocation, and PBKDF2 at 64k iterations
measured ~7.5ms on its own. Shrinking the server's count until it fit would have
left a hash worth very little. Instead the browser derives an auth key with 600k
iterations, salted with the email address, and sends that in place of the
password; the Worker stores a 10k-iteration hash over it. An attacker with the
database pays 610k iterations per guess and the Worker pays ~1-3ms. See
`src/shared/password-kdf.ts`.

**Invites may be instance-wide.** `invites.ledger_id` is now nullable: NULL
admits someone to tally and joins them to no ledger, non-null keeps the original
behaviour. The owner issues instance invites from the admin panel; any member
still issues ledger invites.

**There is still no public signup.** An invite remains the only way to create an
account. That is the property worth keeping - the friction that was actually
hurting was the credential, not the gate.

## Consequences

- Password sign-in is only as strong as the password. Length is the sole rule
  (10 characters); composition rules push people toward `Passw0rd!` and buy
  nothing. The PBKDF2 cost is the rate limiter - roughly 20 guesses a second per
  attacker connection - and there is no lockout table. For an invite-gated
  instance of this size that is the accepted trade. If the instance ever opens
  up, a lockout becomes mandatory.
- Splitting the KDF has three prices, all accepted. The auth key is
  password-equivalent in transit - no worse than the password, and TLS covers
  both. The server can no longer enforce a minimum password length, because it
  only ever sees a fixed-length key; length is checked client-side, and a short
  password harms nobody but its owner. And the derivation is a browser-only
  contract: a second client would have to reproduce it exactly. There is only
  ever one client, so it is not specified anywhere but the source.
- Email is the KDF salt, which is the second reason it is immutable: changing an
  address would silently invalidate the password derived under the old one.
- `hasPassword` joins `credentials` in deciding whether an account is complete.
  An account with a password and no passkey is finished, not half-enrolled - the
  client's "bounce to /welcome" guard had to learn this.
- Email is a unique key and the sign-in identifier, so it is set through the
  password endpoint and is deliberately not patchable as a profile field.
- Deleting an account soft-deletes the user, releases the email, and marks them
  left everywhere - but never touches their expenses or splits. Balances are
  derived (ADR 0004), so the history has to stay or everyone else's numbers move.

## Alternatives rejected

- **Public signup.** Removes the one gate that makes an instance of this size
  safe to run without abuse tooling.
- **Password instead of passkeys.** Throws away a working, phishing-resistant
  path and the frozen RP ID that guarantees it keeps working.
- **A shared instance-wide join code.** One secret for everyone, revocable only
  by rotating it for everyone. A single-use invite is strictly better and the
  table already existed.

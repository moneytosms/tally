# Passkeys as sole auth, and account recovery without email

Research for [issue #5](https://github.com/moneytosms/tally/issues/5). Verified 2026-08-11.

Context: tally is a self-hosted PWA for ~20 non-technical friends. Auth is invite-link + passkey.
No passwords, no SMTP. There is no email fallback, so recovery is a design problem, not a footnote.

**Bottom line:** passkeys are fine as the only auth mechanism at this scale, on current platforms.
The recovery answer is **owner-initiated re-invite**, plus nudging a second passkey after first
sign-in. Recovery codes are the wrong shape for this audience. Details in
[Recovery](#account-recovery-with-no-email-server) below.

---

## 1. Platform support

### Baseline

Synced passkeys are natively supported on Android 9+, iOS/iPadOS 16+, macOS 13+ and Windows.
Chrome OS and Ubuntu rely on browser extensions
([passkeys.dev device support](https://passkeys.dev/device-support/)).

Third-party credential managers (1Password, Bitwarden, Proton Pass) can act as system passkey
providers on Android 14+, iOS 17+, macOS 14+, Windows 25H2+, and via extension on Chrome OS/Ubuntu
([passkeys.dev](https://passkeys.dev/device-support/)).

For a friend group this means: everyone on an iPhone from 2022 or later, or an Android from 2018 or
later, already has a working passkey store with no setup.

### Inside an installed PWA (standalone display mode)

This is the case that matters for tally, and it is the least documented one. What holds up:

- Passkeys are scoped by **RP ID**, not by browser or by app container. A passkey created in Safari
  on `tally.example.com` is the same credential the home-screen app sees, because the platform
  authenticator is system-wide, not per-browser. Apple: "all Web Platform features that are
  available in Safari, including WebAuthn, are available"; passkeys use the device screen-unlock
  method (Face ID / Touch ID, falling back to passcode) for user verification
  ([Apple Passkeys](https://developer.apple.com/passkeys/)).
- On iOS/iPadOS only `display: standalone` is honoured; there is no `minimal-ui`/`fullscreen`
  distinction ([web.dev PWA installation](https://web.dev/learn/pwa/installation)).

Known gaps and bugs to design around:

| Gap | Detail | Source |
|---|---|---|
| Embedded WebViews | `WKWebView` (iOS) and Android `WebView` restrict or omit WebAuthn - iOS limits passkeys to the linked domain; Android WebView needs explicit Credential Manager bridging. Use Custom Tabs / `ASWebAuthenticationSession`, never a raw WebView. | [passkeys.dev iOS](https://passkeys.dev/docs/reference/ios/), [Android](https://passkeys.dev/docs/reference/android/) |
| In-app browsers | Instagram/TikTok/Facebook/LinkedIn open links in embedded WebViews with no WebAuthn bridge; the passkey button silently fails. **An invite link pasted into a group chat will often open here.** | see §6 |
| Cross-origin `create()` | Safari does not support `navigator.credentials.create()` cross-origin, so passkey enrolment inside an iframe fails on Safari/iOS. Not relevant if tally enrols on its own top-level origin. | [Corbado (secondary)](https://www.corbado.com/blog/webauthn-errors) |
| Firefox for Android | No conditional UI through v125 - autofill prompts never appear even with a valid passkey. | [passkeys.dev device support](https://passkeys.dev/device-support/) |
| iOS conditional UI flake | WebKit bug 251817: conditional UI raises `NotAllowedError: Operation Failed` on alternating page reloads. Still open. | [bugs.webkit.org 251817](https://bugs.webkit.org/show_bug.cgi?id=251817) |
| Android GmsCore | A widespread `NotReadableError`/`NotAllowedError` regression on Android was fixed in GmsCore 25.45.30, rollout completed 2026-01-16. Older/unupdated devices may still hit it. | [issues.chromium.org 476437881](https://issues.chromium.org/issues/476437881) |

The practical PWA rule: **the passkey must be created in the real browser or the installed app on a
top-level navigation.** The invite flow must not run inside an in-app browser.

### Conditional UI / autofill

`mediation: "conditional"` presents discovered credentials in a non-modal autofill dropdown
([MDN `CredentialsContainer.get()`](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get)).
Current support ([passkeys.dev](https://passkeys.dev/device-support/)):

- iOS 16.1+: Safari, Chrome, Edge, Firefox
- macOS: Safari 16.1+, Chrome 108+, Firefox 122+, Edge 122+
- Android: Chrome 108+, Edge 122+ (**not Firefox**)
- Windows: Chrome 108+, Firefox 122+, Edge 122+

Conditional *create* (silently upgrade a password login to a passkey) is newer - iOS 18+,
macOS Safari 18+, Android Chrome 142+, Windows/Ubuntu Chrome 136+. tally has no passwords, so
conditional create is irrelevant here.

For ~20 users with one passkey each, conditional UI is a nicety, not a requirement. A plain
"Sign in" button calling `get()` with an empty `allowCredentials` (discoverable credential flow)
works everywhere and dodges the WebKit 251817 flake entirely. **Recommend: skip conditional UI at
launch.**

---

## 2. Syncing, and what happens when a friend buys a new phone

### Apple / iCloud Keychain

Passkeys sync through iCloud Keychain, which is end-to-end encrypted and escrowed to hardware
security modules; recovery on a new device requires the user's iCloud account plus a device
passcode ([Apple Platform Security: passkey
security](https://support.apple.com/guide/security/passkey-security-sec8b0f2f52c/web),
[secure iCloud Keychain
recovery](https://support.apple.com/guide/security/secure-icloud-keychain-recovery-secdeb202947/web)).

**New iPhone, same Apple Account:** passkeys are simply there after sign-in. Nothing for tally to
do. This is the common case and it is genuinely seamless.

### Google / Google Password Manager

GPM encrypts passkey secrets end-to-end; "Google can't use them to impersonate users"
([Google Identity: Passkeys](https://developers.google.com/identity/passkeys),
[Google Security Blog](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html)).

Recovery of the E2EE keys on a new device requires **the screen lock (PIN/password/pattern) of an
existing device, or the Google Password Manager PIN**. Google does not know the screen lock; the
verification data lives in server-side secure enclaves that enforce a **maximum of 10 guesses**
([Google Security Blog](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html),
[GPM PIN help](https://support.google.com/chrome/answer/16608973)).

**New Android, device-to-device transfer:** keys move across, passkeys are there.
**New Android, old phone lost/bricked:** the friend must remember their *old phone's* screen lock or
their GPM PIN. This is the realistic failure mode - a non-technical user who replaced a dead phone
and never knew there was a separate GPM PIN. **This is the single most likely reason tally will
need account recovery.**

### Switching ecosystems (Android → iPhone, or vice versa)

**Passkeys do not migrate.** There is no cross-ecosystem sync between iCloud Keychain and Google
Password Manager. The FIDO Alliance's Credential Exchange Protocol/Format (CXP/CXF) is designed to
fix exactly this, but as of 2026 the specs remain **working drafts** published 2024-05-22 and
explicitly "not yet intended for implementation"
([FIDO Alliance CX specs](https://fidoalliance.org/specifications-credential-exchange-specifications/)).
1Password announced CXP support in early 2026, but provider-to-provider transfer is not something a
non-technical friend will do.

So: **a friend switching from Android to iPhone loses their tally passkey.** This is not a bug, it
is the current state of the ecosystem, and any design must assume it happens once or twice a year in
a 20-person group.

Mitigation that costs nothing: a passkey stored in a **third-party manager** (1Password, Bitwarden,
Proton Pass) survives the switch, because the manager is cross-platform. Do not require it - but
if a friend already uses one, it's the best outcome.

### Cross-device authentication (QR)

An existing phone can authenticate a *new* device by QR + Bluetooth proximity. Caveat from
[passkeys.dev iOS](https://passkeys.dev/docs/reference/ios/): **iOS/iPadOS as an authenticator does
not support persistent linking, so the QR code must be scanned on every use.** Only Windows 11
23H2+ supports persistent linking ([passkeys.dev Android](https://passkeys.dev/docs/reference/android/)).

CDA is a good bootstrap path (old phone still works, new laptop needs access) but a poor daily
driver, and useless when the old phone is gone.

---

## 3. Multiple passkeys per account

Yes, and this is the officially recommended defence against lockout. web.dev's deployment checklist
says explicitly: "Support registering multiple passkeys" and "make sure your database supports
storing multiple passkeys per user"
([passkey checklist](https://web.dev/articles/passkey-checklist),
[passkey registration](https://web.dev/articles/passkey-registration)).

Mechanics:

- Store an **unbounded set** of credentials per user from day one. Retrofitting one-to-many later is
  a migration.
- Pass `excludeCredentials` with the user's existing credential IDs on `create()` so the same
  provider doesn't silently make a duplicate
  ([web.dev excludeCredentials](https://web.dev/articles/webauthn-exclude-credentials)).
- Use `residentKey: "required"` / discoverable credentials so sign-in needs no username
  ([W3C WebAuthn L3 §discoverable credentials](https://www.w3.org/TR/webauthn-3/)).
- Label credentials by AAGUID so the UI can say "iCloud Keychain" vs "1Password"
  ([web.dev AAGUID](https://web.dev/articles/webauthn-aaguid)).

Standard UX for adding a second device, per web.dev: after signing in via cross-device
authentication (`authenticatorAttachment === "cross-platform"`), **offer to create a local passkey
on this device**. That turns a one-off QR scan into a permanent local credential.

---

## 4. RP ID choice

### The rules

An RP ID must be a domain string that is the current origin's host **or a registrable parent of it**,
and must be eTLD+1 or higher. IP addresses and bare public suffixes are rejected - setting `rp.id` to
a public suffix throws `SecurityError`
([web.dev RP ID deep dive](https://web.dev/articles/webauthn-rp-id)).

The spec is blunt about scoping: a credential is scoped such that "only that Relying Party, as
identified by its RP ID, is able to employ the public key credential in authentication ceremonies"
([W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)).

### What breaks if the domain changes

**Every passkey. All of them. Irrecoverably.**

The RP ID is baked into the credential at creation time by the authenticator. Change
`tally.example.com` to `tally.newdomain.com` and every existing credential becomes unusable - the
browser will not even offer them. There is no migration, no re-signing, no server-side fix. Every
one of the ~20 friends must re-enrol from scratch.

For a hobby self-host this is a real risk: domains lapse, get moved, or the free tier gets swapped.

Two mitigations:

1. **Pick the RP ID once and treat it as permanent infrastructure.** Use the registrable domain
   (`example.com`), not the subdomain, if there's any chance the app moves between subdomains -
   `example.com` as RP ID works on `tally.example.com`, `app.example.com`, etc. Narrower RP IDs
   are more tightly scoped but less movable. For a single-app self-host the extra scoping buys
   almost nothing; the movability is worth more.
2. **Related Origin Requests** are the only escape hatch, and only in one direction. Keep the *old*
   domain as the RP ID, serve `https://{RP ID}/.well-known/webauthn` with
   `{"origins": ["https://newdomain.example"]}` (content-type `application/json`), and keep calling
   `create()`/`get()` with the old RP ID from the new origin
   ([web.dev Related Origin Requests](https://web.dev/articles/webauthn-related-origin-requests)).
   Supported in Chrome 128/129+ and Safari 18+; **Firefox as of January 2026 has not shipped it**
   ([passkeys.dev](https://passkeys.dev/docs/advanced/related-origins/),
   [Chrome for Developers](https://developer.chrome.com/blog/passkeys-updates-chrome-129)).
   Note this requires **still controlling the old domain** to serve that file - so it rescues a
   rebrand, not a lapsed registration.

**Recommendation:** buy a cheap domain that will not be given up, use the registrable domain as
RP ID, and record it in an ADR as a load-bearing constant.

### Free-tier platform subdomains (`*.fly.dev`)

Verified against the live Public Suffix List on 2026-08-11 - `fly.dev` is on it
([publicsuffix.org](https://publicsuffix.org/list/public_suffix_list.dat)), along with
`pages.dev`, `workers.dev`, `deno.dev`, `github.io`, `onrender.com`, `vercel.app`.

Consequences:

- `rp.id = "fly.dev"` → **`SecurityError`**, it's a public suffix.
- `rp.id = "tally.fly.dev"` → **valid**, it's eTLD+1. Passkeys work fine.
- Being a public suffix is actually a *security win* here: it guarantees `otherapp.fly.dev` cannot
  claim your RP ID, the way `evil.example.com` could if RP ID were `example.com` on a shared domain.

So `*.fly.dev` is technically fine for passkeys. The problem is not the PSL, it's **rug-pull risk**:
the app name is the RP ID. Rename the Fly app, migrate to another host, or lose the name, and you
have executed the domain-change scenario above - every passkey dead. Same for `*.vercel.app` etc.

**Recommendation:** a custom domain, from the first deploy. It is the cheapest insurance in this
entire document.

---

## 5. Account recovery with no email server

The hard part. When a friend loses their passkey and there is no SMTP, these are the realistic
options.

Framing: the threat model is a ~20-person friend circle splitting expenses. The attacker is not a
nation state; it is a plausible-sounding stranger, or a friend's misplaced phone. The cost of a
false recovery is "someone can see and edit who owes whom money" - embarrassing and annoying, not
catastrophic. The cost of *failed* recovery is a friend permanently locked out of a shared ledger,
which is worse. **Optimise for recoverability, with a human in the loop.**

### Option A - Recovery codes

Generate N single-use codes at signup, user stores them.

- **Security:** This reintroduces a bearer secret - exactly what "no passwords" was meant to
  eliminate. If followed properly (NIST SP 800-63B §lookup secrets: hashed with an approved function,
  salted if under 112 bits, single-use, rate-limited)
  ([NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)) it is
  cryptographically sound. But security in practice equals wherever the friend put the code - which
  is a screenshot in their camera roll, synced to the same cloud account as the passkey they lost.
- **UX cost for a non-technical user:** High and front-loaded, at exactly the wrong moment. Signup is
  when motivation is lowest. Realistically: ~15 of 20 friends will not save the code, and will not
  know they didn't. Codes then create false confidence - the team believes recovery is handled, and
  it isn't.
- **Verdict:** Not as the primary mechanism. Genuinely useful for the *owner's own* account (see
  below).

### Option B - Owner-initiated re-invite

Friend loses phone, messages the owner in the group chat, owner clicks "reset access" on their
account and sends a fresh single-use invite link.

- **Security:** Verification is out-of-band and social: the owner knows these people, recognises
  their voice, has met them. That is a **stronger** identity check than an emailed link for a
  20-person group. Attack surface reduces to (a) compromising the owner's account, and (b) the
  invite link in transit - mitigate with short expiry (~15 min), single use, high-entropy token,
  hashed at rest, and invalidation of all prior tokens for that user on issue.
- **UX cost:** Near zero for the friend. They already message the owner about everything else. No
  artefact to store, nothing to lose, nothing to understand at signup - and it's identical to the
  flow they already used to *join*, so there's nothing new to learn.
- **Weakness:** owner is a single point of failure and must be reachable. For their own account, the
  owner needs a different answer - recovery codes (Option A) or direct DB/CLI access, which they
  have anyway as the person running the server.
- **Verdict:** **Recommended.**

### Option C - Second passkey registered at signup

Force enrolment of two credentials before the account is usable.

- **Security:** Excellent. No new secret material, no new attack surface, and it is the mechanism
  the platform vendors themselves recommend ([web.dev checklist](https://web.dev/articles/passkey-checklist)).
- **UX cost:** Very high **as a hard requirement**. It demands a second device present at signup, or
  a QR cross-device flow that iOS makes re-scan every time (§2). Half the group signs up on the sofa
  with one phone in hand. Blocking on this loses users.
- **Verdict:** Excellent as an **optional prompt after first successful sign-in**, terrible as a
  gate. Prompt once, allow dismissal, re-prompt occasionally. Nudge in particular after a
  cross-device sign-in, per web.dev.

### Option D - Trusted-friend / social recovery

M-of-N group members approve a recovery request.

- **Security:** Good on paper; distributes trust away from the owner. In a group where everyone knows
  everyone, collusion risk is low but so is diligence - people click approve without reading.
- **UX cost:** High to build (quorum state machine, notification/approval surface, expiry, race
  handling, revocation) and moderate to use. And with **no email server there is no notification
  channel** to tell approvers a request exists - it collapses back into "message the group chat,"
  which is Option B with extra machinery.
- **Verdict:** Skip. It is Option B plus a state machine, solving a trust-distribution problem this
  group does not have.

### Recommendation

**Option B as primary, Option C as an optional nudge.**

1. Owner-initiated re-invite is the recovery mechanism. Reuse the existing invite-link code path -
   recovery is just "issue a new invite bound to an existing user id" rather than a new subsystem.
2. After a friend's first successful sign-in, prompt once to add a second passkey. Dismissible.
3. The owner gets recovery codes, or just uses server access. They run the box.
4. Store multiple credentials per user from day one regardless - that schema decision is expensive
   to reverse and free to make now.

What this deliberately skips: recovery codes for everyone (add when the owner becomes a bottleneck,
which at 20 people they won't), and social recovery (add when there is no single trusted owner).

Operational requirement: recovery must **revoke the lost credential**, not just add a new one. A lost
phone that later turns up should not still have access.

---

## 6. In-app browser hazard for invite links

Worth calling out separately because it will bite the very first invite. Invite links pasted into
WhatsApp/Messenger/Instagram open in an embedded WebView, which frequently has no WebAuthn bridge -
the passkey button fails silently with no useful error (§1). Android `WebView` requires explicit
Credential Manager wiring; iOS `WKWebView` restricts passkeys to the linked domain
([passkeys.dev Android](https://passkeys.dev/docs/reference/android/),
[iOS](https://passkeys.dev/docs/reference/ios/)).

Mitigation: feature-detect on the invite landing page
(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`, plus
`getClientCapabilities()` where available - [web.dev](https://web.dev/articles/webauthn-client-capabilities))
and, when unsupported, show "Open in your browser" rather than a button that does nothing.

---

## 7. Server-side libraries

The RP server work is: generate challenge, verify attestation on register, verify assertion on
login, track signature counter. All four libraries below cover discoverable credentials / passkey
flows. Status verified via GitHub API on 2026-08-11.

| Language | Library | Latest release | Last push | Stars | Status |
|---|---|---|---|---|---|
| TypeScript/Node | [MasterKale/SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) | v13.3.2 (2026-06-24) | 2026-08-05 | 2.3k | Actively maintained. Split browser/server packages, Node + Deno. Full passkey/discoverable support, `excludeCredentials`, conditional UI helpers. **De facto standard for TS.** |
| Python | [duo-labs/py_webauthn](https://github.com/duo-labs/py_webauthn) | v3.0.0 (2026-06-29) | 2026-06-29 | 1.1k | Actively maintained, same author as SimpleWebAuthn. Recent major version. Handles discoverable credentials. |
| Go | [go-webauthn/webauthn](https://github.com/go-webauthn/webauthn) | v0.17.4 (2026-05-22) | 2026-08-09 | 1.3k | Actively maintained (community fork of the abandoned duo-labs Go lib - **do not use `duo-labs/webauthn`**). FIDO2 conformant, explicit passkey/discoverable support. Still pre-1.0, API shifts between minors. |
| Rust | [kanidm/webauthn-rs](https://github.com/kanidm/webauthn-rs) | v0.5.2 (2025-07-30) | 2026-07-30 | 696 | Maintained (commits current; release cadence slow - no tagged release in ~12 months). Backs the Kanidm IDM product, so it's exercised in production. Opinionated, security-conscious API; supports passkeys/discoverable credentials as a first-class mode. |

Notes:

- [`github/webauthn-json`](https://github.com/github/webauthn-json) - the common client-side
  base64url wrapper - is **archived** (last release v2.1.1, 2023-01). Use the native
  `PublicKeyCredential.toJSON()` / `parseCreationOptionsFromJSON()` (Chrome 129+, Safari 18+) or
  SimpleWebAuthn's browser package instead.
- Recommendation given the audience and scope: **TypeScript + SimpleWebAuthn**. Best-maintained,
  most documentation, shares an author with the Python option, and one language across the PWA and
  the server is the least code to maintain for a hobby self-host.

---

## Sources

Primary:
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [NIST SP 800-63B, Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
- [Public Suffix List (live, fetched 2026-08-11)](https://publicsuffix.org/list/public_suffix_list.dat)
- [FIDO Alliance - Credential Exchange Specifications](https://fidoalliance.org/specifications-credential-exchange-specifications/)
- [passkeys.dev - device support](https://passkeys.dev/device-support/), [iOS](https://passkeys.dev/docs/reference/ios/), [Android](https://passkeys.dev/docs/reference/android/), [known issues](https://passkeys.dev/docs/reference/known-issues/), [bootstrapping](https://passkeys.dev/docs/use-cases/bootstrapping/), [related origins](https://passkeys.dev/docs/advanced/related-origins/)
- [Apple - Passkeys overview](https://developer.apple.com/passkeys/), [Platform Security: passkey security](https://support.apple.com/guide/security/passkey-security-sec8b0f2f52c/web), [secure iCloud Keychain recovery](https://support.apple.com/guide/security/secure-icloud-keychain-recovery-secdeb202947/web)
- [Google - Passkeys for developers](https://developers.google.com/identity/passkeys), [Security of Passkeys in Google Password Manager](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html), [Manage your GPM PIN](https://support.google.com/chrome/answer/16608973)
- [web.dev - RP ID deep dive](https://web.dev/articles/webauthn-rp-id), [passkey registration](https://web.dev/articles/passkey-registration), [excludeCredentials](https://web.dev/articles/webauthn-exclude-credentials), [deployment checklist](https://web.dev/articles/passkey-checklist), [related origin requests](https://web.dev/articles/webauthn-related-origin-requests), [client capabilities](https://web.dev/articles/webauthn-client-capabilities), [AAGUID](https://web.dev/articles/webauthn-aaguid), [PWA installation](https://web.dev/learn/pwa/installation)
- [Chrome for Developers - passkeys updates in Chrome 129](https://developer.chrome.com/blog/passkeys-updates-chrome-129)
- [MDN - CredentialsContainer.get()](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get)
- Bug trackers: [WebKit 251817](https://bugs.webkit.org/show_bug.cgi?id=251817), [Chromium 476437881](https://issues.chromium.org/issues/476437881)

Secondary (used only where no primary source covered the point, flagged inline):
- [Corbado - WebAuthn errors in production](https://www.corbado.com/blog/webauthn-errors)

---

## Follow-ups for the repo

- ADR: record the RP ID as a permanent, load-bearing constant (`docs/adr/`).
- ADR or CONTEXT.md: recovery = owner-initiated re-invite; schema stores many credentials per user.

# UPI deep links (`upi://pay`) from a PWA — what works, what doesn't

Research for [issue #4](https://github.com/moneytosms/tally/issues/4). Verified 2026-08-11.

Scope: tally is a ledger. No money touches the server, no gateway, no KYC. The only payment
surface is a `upi://pay` link generated client-side. This documents exactly how far that gets
us and what tally must do on its own.

Confidence is marked per claim: **[spec]** = NPCI/platform primary source, **[vendor]** =
payment app / aggregator's own docs, **[field]** = widely reported behaviour, no primary source.

---

## 1. The parameter set

Source: [NPCI UPI Linking Specifications v1.6](https://www.npci.org.in/sites/default/files/UPI%20Linking%20Specs_ver%201.6.pdf)
(mirror used: <https://www.labnol.org/files/linking.pdf>). This is still the document the
ecosystem builds against; v1.7 exists but is not published openly by NPCI.

Format **[spec]**:

```
upi://pay?param-name=param-value&param-name=param-value&...
```

"All PSP applications must mandatorily implement listening to 'UPI' links within their mobile
applications for QR, intent, NFC, BLE, UHF etc."

| Param | Static mode | Dynamic mode | Meaning |
|---|---|---|---|
| `pa` | **M** | **M** | Payee VPA |
| `pn` | **M** | **M** | Payee name |
| `mc` | O | O | Payee merchant category code. "If present then needs to be passed as it is." |
| `tid` | O | O | PSP-generated transaction id. Not for us to invent. |
| `tr` | O | **C** | Transaction reference (order/bill id). "Mandatory for Merchant transactions and dynamic URL generation." |
| `tn` | O | O | Transaction note, short description |
| `am` | O | **M** | Amount, decimal. **"If 'am' is not present then field is editable."** |
| `mam` | O | C | Minimum amount. "If mam tag is not present or `mam=null` or `mam=` then amount field should NOT be editable." |
| `cu` | O | O | Currency. **"Currently ONLY 'INR' is the supported value."** |
| `url` | O | O | Invoice/receipt URL, must be http(s), must relate to that transaction |
| `mode` | **M** | **M** | Initiation mode: `00` default, `01` QR, `02` secure QR, `04` intent, `05` secure intent, `06` NFC, `07` BLE, `08` UHF, `15` SEBI |
| `sign` | **M** | **M** | Base64 RSA signature over the whole string minus `&sign=` |
| `orgid` | **M** | **M** | 6-digit. PSP-initiated → that PSP's orgid. "For merchant initiated/created intent/QR '000000' will be used" |
| `mid` / `msid` / `mtid` | O | O | Merchant / store / terminal id, ≤20 chars, echoed for reconciliation |

Notes that matter **[spec]**:

- **There is no `purpose` parameter in v1.6.** The issue lists it; it does not exist in the
  published spec. It appears in later NPCI QR/mandate material (IPO/ASBA-style purpose codes),
  not in the P2P deep-link surface. Do not emit it.
- Spaces must be `%20` (RFC 3986), not bare `%`; apps must accept both for back-compat.
- Absent tags "can be dropped or passed as null" — do not send the literal string `"null"`.
- `sign`, `mode`, `orgid` are marked M in the table but are a **merchant/PSP signing scheme**.
  An unsigned intent is explicitly handled: if the signature "is not present in intent then the
  application should show warning message to user that the 'source of intent could not be
  verified' and shall request for passcode to proceed with the payment." So unsigned works, with
  a warning and a mandatory PIN — which is what we want anyway.

**Practical minimum for tally**: `pa`, `pn`, `am`, `cu=INR`, `tn`. Plus `tr` if we want our own
reference echoed. Skip `mc`, `mid`, `msid`, `mtid`, `tid`, `sign`, `orgid` — those are merchant
identity and we have none.

**Format traps [field]**: `am` must be a plain decimal string (`250.00`), everything must be
percent-encoded via a real URL builder. Malformed payloads produce a generic, unhelpful error
inside the payment app, not a diagnosable failure.

---

## 2. Is `am` honoured?

Yes, on Android, in every major app. **[spec]** + **[vendor]**

- Spec: with `am` present and `mam` absent/null, "amount field should NOT be editable". The
  payer sees a locked amount and taps pay.
- Google Pay for India documents accepting exactly `pa`, `pn`, `mc`, `tr`, `tn`, `am`, `cu`, `url`
  on a `upi://pay` URI and building it with `startActivityForResult`
  ([Google Pay India, in-app payments](https://developers.google.com/pay/india/api/android/in-app-payments)).
  Notably GPay's docs mention **no** `mode`, `orgid` or `sign` — consistent with unsigned P2P
  intents being accepted.
- Paytm and PhonePe both ship UPI-intent products built on the same URI shape **[vendor]**.

Caveat **[field]**: apps are stricter about *merchant-shaped* links than P2P ones. Passing a
partial merchant identity (`mc` without `mid`/`tr`, or a `tr` that looks like a merchant order id)
is the common cause of "transaction cannot be completed" dialogs. For a P2P settle-up, send the
minimum set and no merchant fields at all.

**`pn` is cosmetic and now largely ignored.** NPCI OC-101A (issued April 2025, compliance
30 June 2025, live 1 July 2025) requires UPI apps to display only the ultimate beneficiary's
banking name fetched from the Validate Address API, and states that names taken from QR codes or
user-defined names "should not be displayed to the payer", and that apps must remove features
letting users edit a beneficiary name
([NPCI/UPI/OC No-101A/2025-26](https://www.npci.org.in/uploads/UPI_OC_No_101_A_FY_2025_26_Strengthening_beneficiary_name_verification_and_display_during_UPI_transactions_eb7bd7ed72.pdf),
summarised at [TeamLease RegTech](https://www.teamleaseregtech.com/updates/article/41953/npci-issued-addendum-to-oc-101-mandatory-display-of-ultimate-beneficia/)).
So `pn` is still mandatory in the URL but the payer will see the bank's name for that VPA, not
ours. Consequence for tally: **the payer's confirmation screen is the real identity check**, and a
friend's display name in tally being wrong is harmless; a wrong VPA is not.

---

## 3. Android browser tab

Source: [Android Intents with Chrome](https://developer.chrome.com/docs/android/intents) and the
Chromium [`components/external_intents`](https://chromium.googlesource.com/chromium/src/+/lkgr/components/external_intents/)
implementation.

Works, with hard rules **[spec]**:

- **A user gesture is required.** Chromium's `ExternalNavigationHandler` blocks (or downgrades to
  a prompt) any renderer-initiated navigation chain where `!hasUserGesture`. Chrome's own docs:
  "Chrome won't launch an external app for a given Intent URI if: The Intent URI is redirected
  from a typed in URL; The Intent URI is initiated without user gesture."
  → tally must fire the link from a direct click/tap handler. No `setTimeout`, no auto-redirect
  after render, no fetch-then-navigate.
- Multiple UPI apps installed → Android shows the app chooser. Normal, fine.
- One app installed → straight into it.

## 4. Android, installed PWA (standalone) — the case that matters

**It works.** Chain of evidence **[spec]**:

- An installed PWA on Android runs as a WebAPK inside Chrome; `WebappActivity extends
  BaseCustomTabActivity` ([Chromium source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappActivity.java)).
- `components/external_intents` is installed "for each 'tab' of the embedder", explicitly
  covering "Custom Tabs and Tab-like contexts". So the same external-protocol interception that
  launches `upi://` from a normal tab is active in the PWA window.

So a tap on a `upi://pay` link inside the standalone PWA hands off to the UPI app exactly as in a
tab. The failures are not in the launch, they are on either side of it:

1. **Silent failure has no UI.** In a tab, a failed external launch at least leaves a visible
   omnibox and error affordance. In standalone there is no browser chrome — if nothing happens,
   the user just sees the button do nothing. Design for this: show our own "Didn't open your UPI
   app?" fallback (QR + copyable VPA) next to the button, always.
2. **The return trip is an app switch, not a navigation.** The PWA is backgrounded. Android may
   evict it; on return it can cold-start and re-render from scratch. Any "pending settlement"
   state must be persisted (server or IndexedDB/localStorage) *before* firing the link, never
   held in component state.
3. **No gesture, no launch** (as above) — same rule applies in standalone.

## 5. iOS

Materially worse, and NPCI itself treats iOS as a special case.

- iOS has **no intent chooser**. Custom URL schemes are first-come/undefined when more than one
  app registers the same scheme, and Apple positions custom schemes as the weak alternative to
  Universal Links ([Apple: Defining a custom URL scheme for your app](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app)).
  Which app answers `upi://` on a given iPhone is therefore not determinable by us **[spec]**.
- Payment apps on iOS document their own schemes instead — Google Pay's iOS integration uses
  `gpay://upi/pay?...` with the same query parameters
  ([Google Pay India, iOS](https://developers.google.com/pay/india/api/ios/in-app-payments)) **[vendor]**;
  PhonePe and Paytm likewise use app-specific schemes. A single `upi://` link is not the portable
  answer on iOS that it is on Android.
- If no app is registered for the scheme, iOS does nothing visible from a web context **[field]** —
  and in an installed (standalone) home-screen web app there is no browser UI to report it, same
  blind-failure problem as §4.1 but more likely to trigger.
- Corroboration that the ecosystem considers iOS intent-handoff unreliable: when NPCI mandated
  deprecation of the UPI Collect flow (manual VPA entry) with a 28 Feb 2026 cutover, **iOS mobile
  app and mobile web transactions were exempted** and continue to allow Collect "until further
  notice", while Android is intent-only and desktop/web is QR-only
  ([Cashfree: UPI Collect deprecation](https://www.cashfree.com/docs/payments/manage/payment-methods/upi-collect),
  [PayU](https://docs.payu.in/docs/upi-collect-disablement-information)) **[vendor]**.

**Recommendation for tally on iOS**: do not rely on `upi://`. Show the QR code plus a
tap-to-copy VPA and amount as the primary path, and offer the deep link as a best-effort button.
The QR path is also the sanctioned flow for desktop.

## 6. No UPI app installed

**Nothing happens, silently.** **[spec]**

Chromium's `maybeAskToLaunchApp`: "No app can resolve the intent, don't prompt." Chrome only shows
a "leave Chrome?" message when it can name the single app that would be launched; when nothing
resolves, or when the intent resolves to the chooser, it returns `forNoOverride` and the
navigation is simply dropped. There is no error event, no exception, nothing observable from JS.

Mitigations:

- We cannot detect installed apps from the web. `navigator.canShare`/`canOpenURL` equivalents do
  not exist; probing is not possible.
- Chrome's `intent://…#Intent;scheme=upi;S.browser_fallback_url=…;end` form *does* give a real
  fallback ("Chrome removes browser_fallback_url so the target app doesn't see this value"), but
  it is Chrome-on-Android only and requires targeting a scheme/package. Usable as a progressive
  enhancement; not a substitute for the always-visible QR/copy fallback.
- The lazy, correct answer: always render the QR + VPA + amount alongside the button. It costs
  nothing, covers iOS, desktop, no-app, and blocked-launch in one shot.

## 7. Does anything come back to tally after payment?

**No. Nothing. Confirmed, not hedged.**

The NPCI spec does define response parameters — `txnId`, `responseCode`, `ApprovalRefNo`,
`Status` (`SUBMITTED`/`SUCCESS`/`FAILURE`), `txnRef` — but they are returned **from the PSP app to
the calling Android app**, via the Android activity result. Google Pay's documented integration is
`startActivityForResult` → `onActivityResult`
([Google Pay India](https://developers.google.com/pay/india/api/android/in-app-payments)). A web
page has no activity to receive that result, and the spec adds "the bank application may need to
whitelist the Merchant App URL" — a merchant-onboarding step we have no way to perform.

The spec's own guidance is that even native callers must not trust the returned value: "As a
standard practice merchant app must check the final status with their server/PSP server." That
server-side status check requires a PSP/aggregator relationship, i.e. a payment gateway and KYC —
explicitly out of scope for tally.

Conclusion: **after the user taps settle up, tally learns nothing.** Not success, not failure, not
abandonment. The `url` parameter is an invoice link the payer may tap; it is not a callback and
carries no transaction outcome. Everything downstream of the tap must be modelled as an assertion
by a human, not an observation by the system.

## 8. Is tally, a personal self-hosted app, allowed to generate these links?

Yes. **[spec]**, with one recent-rules caveat.

- The spec explicitly blesses generating a URL and sharing it: "Create the URL and allow standard
  'share' allowing a UPI payment intent to be sent via chat or email. Receiver will click on the
  link to then invoke their PSP application." It also anticipates "3rd party general purpose
  utility applications" that construct and launch these links.
- Signing is a merchant/PSP mechanism; unsigned intents are a defined, permitted case that
  degrades to a warning + PIN (§1.3). There is no registration gate on emitting an unsigned P2P
  `upi://pay` URL. Nothing in the spec requires the *generator* of the link to be an onboarded
  merchant.
- We are not a PSP, not a TPAP, not a merchant, and we never touch funds, so the compliance
  regime aimed at those parties (NPCI OC-215 API-usage guidelines of 21 May 2025, effective
  31 July 2025, rate-limiting balance-enquiry/account-listing/status APIs
  — see [TeamLease RegTech summary](https://www.teamleaseregtech.com/updates/article/42884/npci-issued-guidelines-on-the-usage-of-upi-api/))
  does not apply to us. It does apply to anyone we'd have to integrate with to get more.

Currency check as of 2026-08-11 — the two changes that landed since the spec and that touch us:

1. **P2P collect requests abolished from 1 October 2025** (NPCI circular 29 July 2025). Pull
   payments between individuals no longer exist on UPI
   ([Business Today](https://www.businesstoday.in/personal-finance/banking/story/npci-to-tighten-upi-rules-peer-to-peer-collect-feature-to-end-in-october-489244-2025-08-13),
   [Medianama](https://www.medianama.com/2025/08/223-npci-p2p-collect-payments-oct-1-what-it-means/)).
   → tally can never "request" money in-band. A settle-up is always the *payer* pushing. Design
   the UI around "you owe X, pay now", not around the payee sending a request.
2. **UPI Collect (manual VPA entry) deprecated for P2M from 28 February 2026**, Android moving to
   intent-only, desktop to QR-only, iOS exempt **[vendor]**. This does not restrict us — intent
   and QR are precisely the two surviving flows and are what we emit.

Neither change removes the `upi://pay` intent. Both push the ecosystem *toward* it.

## 9. Can a VPA be validated without a transaction?

**Not by tally.** **[vendor]**

VPA validation is NPCI's ValidateAddress / Verify-VPA API, reachable only through a PSP bank or a
payment aggregator: Razorpay ([Validate VPA](https://razorpay.com/docs/payments/payment-methods/upi/vpa-validation/)),
Cashfree, Juspay ([Verify VPA](https://juspay.io/in/docs/api-reference/docs/express-checkout/verfiy-vpa)),
Paytm, PhonePe. Every one of them requires an onboarded, KYC'd merchant account and server-side
credentials. That is exactly the thing tally has decided not to be. Note also that OC-101A's
"display the banking name" rule is itself implemented *by the payer's app* via ValidateAddress —
another reason the payer's confirmation screen is our validation step, not ours.

What tally can do, and should stop at:

- Syntactic check only: `^[\w.\-]{2,256}@[a-zA-Z]{2,64}$`, trim whitespace, lowercase the handle.
  This catches typos in shape, not in identity.
- Show the VPA back to the user verbatim before saving, and show it again on the settle-up screen.
- Let the payer be the check. Their app displays the bank-verified name for that VPA before the
  PIN. A wrong VPA fails there, visibly, before money moves.

Do not build reverse-penny-drop, do not build a "verify" button that can't verify.

---

## 10. Design consequence: how does a settle-up get marked done?

Given §7, there are exactly three options, and every comparable app has landed in the same place.

**How Splitwise does it** ([Splitwise help](https://feedback.splitwise.com/knowledgebase/articles/1088920-how-do-i-use-splitwise)):
"Settle up" records a payment made outside the app — cash, bank transfer, whatever. It is a
self-declared ledger entry. The other party is notified (email/push, visible in Recent Activity)
but does **not** approve it. There is no accept/reject; that has been an open user request for
years without being shipped
([1](https://feedback.splitwise.com/forums/162446-general/suggestions/9310881-settle-up-should-have-accept-or-reject),
[2](https://feedback.splitwise.com/forums/162446-general/suggestions/3864369-allow-receiver-to-confirm-payment-before-it-reflec)).
Undo is just deleting the payment entry like any other expense
([undo a settlement](https://feedback.splitwise.com/knowledgebase/articles/843558-how-do-i-undo-a-settlement)).
Partial settlements are supported by editing the amount.

The options:

| Option | What it means | Cost | Failure mode |
|---|---|---|---|
| **A. Payer confirms** (Splitwise's model) | Payer taps settle up, fires the link, comes back, taps "I paid". Balance clears immediately. Payee is notified. | Trivial. One boolean, one notification. | Payer marks paid without paying, or in good faith after a failed transaction. Payee finds out later and disputes socially. |
| **B. Payee confirms** | Payer's tap creates a *pending* settlement; balance only clears when the payee says "received". | Two states, a pending list, a notification the payee must act on. | Payee is slow or never opens the app. Ledger sits wrong in the *other* direction, which is worse — it under-credits someone who actually paid. |
| **C. Both** | Payer asserts, payee acknowledges, both timestamps recorded; balance clears on payer's assert, payee's ack is a green tick on top. | Middle. One extra nullable timestamp. | Nagging. Two-step ceremony for ₹200. |

**Recommendation: A, with C's data shape.** Clear the balance on the payer's assertion — that is
what every user of a friend-group app expects and what Splitwise proved is socially sufficient.
Record `settled_by`, `settled_at`, and a nullable `acknowledged_at`; expose the acknowledgement as
an optional one-tap "got it" for the payee, and render an un-acknowledged settlement with a subtle
"awaiting confirmation" marker rather than blocking on it. Deletion/undo is the dispute mechanism.

This is a trust model, not a security model, and that is correct: it is a friend group and the
ledger is advisory. B is the wrong default precisely because a missing acknowledgement is
indistinguishable from an inattentive payee.

Implementation notes that fall out of the earlier sections:

- Persist the pending settlement **before** firing the deep link (§4.2), so a cold-started PWA
  comes back to "Did your payment to Ravi go through? [Yes] [No]" instead of a blank slate.
- Never auto-mark on link launch. Launching the app is not paying; the user may abandon at the
  PIN screen. Only an explicit post-return tap.
- Include the same amount in the prompt as in `am`, so a partial payment gets recorded as partial.

---

## 11. Non-India fallback (brief)

Same shape, same limitation — a scheme link that pre-fills a payment and returns nothing.

- **Venmo** (US): `venmo://paycharge?txn=pay&recipients=<user>&amount=<n>&note=<s>`, and a web
  form `https://venmo.com/<user>?txn=pay&amount=&note=`. `txn=charge` requests instead of pays —
  but note UPI has no equivalent since Oct 2025 (§8).
- **PayPal.Me**: `paypal.me/<user>/<amount>` pre-fills the amount, and `/25AUD` sets currency.
  No note field. Plain https, so no scheme problem, no PWA problem.
- **SEPA**: EPC069-12 QR payload is the European analogue; no universal scheme link.

None of them return a confirmation to a web app either, so §10 is the design regardless of
geography. Whatever tally builds for "mark as settled" is the load-bearing part; the deep link is
a convenience on top.

---

## Summary for tally

1. Emit `upi://pay?pa&pn&am&cu=INR&tn` (+`tr`). Nothing merchant-shaped. No `purpose` — it isn't real.
2. Fire it only from a direct tap. Android tab and installed PWA both work; iOS is unreliable.
3. Always render QR + copyable VPA next to the button. That is the iOS, desktop, no-app, and
   silent-failure path all at once.
4. Persist the pending settlement before launching.
5. Nothing comes back. Ever. Mark settled on the payer's explicit confirmation after return;
   offer the payee an optional acknowledgement.
6. Don't try to validate VPAs. The payer's app does it, with the bank's name, at PIN time.

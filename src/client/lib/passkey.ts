// Diagnosing passkey trouble in the client.
//
// Auth is passkeys only - no password, no email, no support inbox. "Something
// went wrong." is therefore not a lazy fallback here, it is a dead end: the
// reader cannot tell "you cancelled" from "this browser can't do it" from "your
// invite is spent", and the owner has nothing to debug with either. Every
// failure on the enrolment path resolves to a message that names a next step.
//
// The case this exists for is the in-app browser. An invite link pasted into a
// group chat opens inside WhatsApp/Instagram, which on iOS is a WKWebView that
// reports a platform authenticator as AVAILABLE - so feature detection passes,
// the button renders, and `create()` only fails once the sheet is up. That is
// docs/research/passkeys.md §6, "it will bite the very first invite".
import { ApiError } from "~/client/lib/api";

/** Which ceremony failed. The same DOMException means different things in each. */
export type Ceremony = "register" | "signIn";

export type AuthFailure = {
  /** i18n key for the sentence shown to the person. */
  messageKey: string;
  /** Offer the "open this in a real browser" escape hatch under the message. */
  escapeHatch: boolean;
  /** Machine-readable error name, shown small. The owner is the support desk on
   *  a self-hosted instance; without this a bug report is "it didn't work". */
  detail?: string;
};

/** A failure with nothing to diagnose - validation the page itself raised. */
export function plainFailure(messageKey: string): AuthFailure {
  return { messageKey, escapeHatch: false };
}

/**
 * SimpleWebAuthn wraps the eight spec errors in a `WebAuthnError` that copies
 * `cause.name` onto itself and adds a coarser `code`. Read `name` first (it is
 * the DOMException name in every wrapped case) and fall back to `cause`, so this
 * keeps working against a bare `navigator.credentials` error too.
 */
function errorName(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  if (e.name && e.name !== "Error" && e.name !== "WebAuthnError") return e.name;
  const cause = (e as { cause?: unknown }).cause;
  return cause instanceof Error ? cause.name : undefined;
}

export function classifyAuthError(e: unknown, ceremony: Ceremony): AuthFailure {
  if (e instanceof ApiError) return classifyApiError(e, ceremony);

  const name = errorName(e);
  switch (name) {
    // Overloaded by every platform: user cancelled, timed out, OR the embedded
    // browser has no WebAuthn bridge. It cannot be split apart from here, so the
    // message covers the cancel case and the escape hatch covers the other one.
    case "NotAllowedError":
      return {
        messageKey: ceremony === "register" ? "onboarding.errorCancelled" : "onboarding.errorSignInCancelled",
        escapeHatch: true,
        detail: name,
      };
    // The authenticator already holds a credential we sent in excludeCredentials.
    // They have an account; enrolling again is not what they want.
    case "InvalidStateError":
      return { messageKey: "onboarding.errorAlreadyEnrolled", escapeHatch: false, detail: name };
    // RP ID vs. effective domain. Either the app is being served from a host the
    // frozen RP ID does not cover, or this is an iframe. Never a user error.
    case "SecurityError":
      return { messageKey: "onboarding.errorDomain", escapeHatch: false, detail: name };
    case "NotSupportedError":
    case "ConstraintError":
      return { messageKey: "onboarding.errorUnsupported", escapeHatch: true, detail: name };
    case "AbortError":
      return { messageKey: "onboarding.errorAborted", escapeHatch: false, detail: name };
    case "UnknownError":
      return { messageKey: "onboarding.errorAuthenticator", escapeHatch: false, detail: name };
  }

  // startRegistration/startAuthentication throw a plain Error before they ever
  // reach the authenticator when `navigator.credentials` is missing entirely.
  if (e instanceof Error && /not supported in this browser/i.test(e.message)) {
    return { messageKey: "onboarding.errorUnsupported", escapeHatch: true };
  }
  return { messageKey: "error.generic", escapeHatch: false, detail: name };
}

function classifyApiError(e: ApiError, ceremony: Ceremony): AuthFailure {
  if (e.code === "offline") return plainFailure("error.network");
  // 403 on the registration path means one thing only: no invite, no unclaimed
  // instance. Every other rejection reason deliberately collapses into it.
  if (e.status === 403) return plainFailure("onboarding.closedInstance");
  // The session cookie from register/options is gone by the time verify runs -
  // cleared cookies, or a device that dropped it. Starting over is the fix.
  if (e.status === 401 && ceremony === "register") {
    return { messageKey: "onboarding.errorSessionLost", escapeHatch: false, detail: "401" };
  }
  if (e.code === "webauthn") {
    return {
      messageKey: ceremony === "register" ? "onboarding.errorVerify" : "onboarding.errorNoAccount",
      escapeHatch: false,
      detail: "webauthn",
    };
  }
  // The passkey worked; the invite behind it did not. Distinct from 403 because
  // the account now EXISTS - they need a new link, not a first one.
  if (e.code === "invite") return { messageKey: "onboarding.errorInviteSpent", escapeHatch: false, detail: "invite" };
  if (e.status >= 500) return { messageKey: "onboarding.errorServer", escapeHatch: false, detail: String(e.status) };
  return { messageKey: "error.generic", escapeHatch: false, detail: String(e.status) };
}

/**
 * True for a link opened inside another app's WebView on iOS.
 *
 * Feature detection cannot catch this one - the WKWebView reports the platform
 * authenticator as available and then fails at `create()` - so the only warning
 * that arrives BEFORE the failure is the user agent. Safari, and Chrome, Firefox,
 * Edge and Opera on iOS, all carry a recognisable token; a bare WKWebView carries
 * none of them. Heuristic by nature: it only ever adds a warning and an escape
 * hatch, and never blocks the button, so a false positive costs a sentence.
 */
export function isEmbeddedIosBrowser(userAgent: string): boolean {
  if (!/iPhone|iPad|iPod/.test(userAgent)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)) return false;
  return !/Safari\//.test(userAgent);
}

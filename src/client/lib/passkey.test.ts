// What's tested here is the thing that actually broke: a passkey failure that
// reached the reader as "Something went wrong." and left them nowhere to go.
// Every branch must resolve to a message that is NOT error.generic, and the
// in-app browser cases must offer the escape hatch.
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { classifyAuthError, isEmbeddedIosBrowser } from "./passkey";
import { t } from "~/client/i18n";

/** How SimpleWebAuthn hands these up: name copied off the cause, coarse code. */
class WebAuthnError extends Error {
  constructor(cause: DOMException) {
    super(cause.message, { cause });
    this.name = cause.name;
  }
}

const domError = (name: string) => new DOMException("nope", name);

describe("classifyAuthError", () => {
  it("never leaves a WebAuthn ceremony failure as the generic message", () => {
    const names = [
      "NotAllowedError",
      "InvalidStateError",
      "SecurityError",
      "NotSupportedError",
      "ConstraintError",
      "AbortError",
      "UnknownError",
    ];
    for (const name of names) {
      const failure = classifyAuthError(new WebAuthnError(domError(name)), "register");
      expect(failure.messageKey, name).not.toBe("error.generic");
      expect(failure.detail, name).toBe(name);
      // every key resolves - t() returns the key itself when it is missing
      expect(t(failure.messageKey), name).not.toBe(failure.messageKey);
    }
  });

  it("reads the name off the cause when the wrapper kept its own", () => {
    const wrapped = new Error("boom", { cause: domError("NotAllowedError") });
    wrapped.name = "WebAuthnError";
    expect(classifyAuthError(wrapped, "register").detail).toBe("NotAllowedError");
  });

  it("offers the escape hatch exactly where an in-app browser is possible", () => {
    // NotAllowedError is what a WKWebView with no WebAuthn bridge produces, and
    // it is ALSO a plain cancel - so the hatch is offered, not forced.
    expect(classifyAuthError(new WebAuthnError(domError("NotAllowedError")), "register").escapeHatch).toBe(true);
    expect(classifyAuthError(new WebAuthnError(domError("NotSupportedError")), "register").escapeHatch).toBe(true);
    // A domain mismatch is the owner's deployment being wrong. Another browser
    // will not fix it, and the hatch would print the wrong URL as if it helped.
    expect(classifyAuthError(new WebAuthnError(domError("SecurityError")), "register").escapeHatch).toBe(false);
  });

  it("separates the two ceremonies where the same error means different things", () => {
    const cancelled = domError("NotAllowedError");
    expect(classifyAuthError(new WebAuthnError(cancelled), "register").messageKey).toBe("onboarding.errorCancelled");
    expect(classifyAuthError(new WebAuthnError(cancelled), "signIn").messageKey).toBe(
      "onboarding.errorSignInCancelled",
    );
  });

  it("keeps 403 meaning invite-only, and nothing else meaning that", () => {
    expect(classifyAuthError(new ApiError(403, "forbidden"), "register").messageKey).toBe(
      "onboarding.closedInstance",
    );
    expect(classifyAuthError(new ApiError(401, "unauthenticated"), "register").messageKey).toBe(
      "onboarding.errorSessionLost",
    );
    expect(classifyAuthError(new ApiError(500, "internal error"), "register").messageKey).toBe(
      "onboarding.errorServer",
    );
  });

  it("distinguishes a spent invite from a closed instance", () => {
    // The passkey succeeded and the account exists; only the link is dead. The
    // fix is a NEW link, which "this instance is invite-only" does not say.
    const failure = classifyAuthError(new ApiError(400, "invite is not usable", "invite"), "register");
    expect(failure.messageKey).toBe("onboarding.errorInviteSpent");
  });

  it("tells a failed enrolment apart from a sign-in with no account", () => {
    const webauthn = new ApiError(400, "registration failed", "webauthn");
    expect(classifyAuthError(webauthn, "register").messageKey).toBe("onboarding.errorVerify");
    expect(classifyAuthError(webauthn, "signIn").messageKey).toBe("onboarding.errorNoAccount");
  });

  it("still reports offline as offline", () => {
    expect(classifyAuthError(new ApiError(0, "offline", "offline"), "register").messageKey).toBe("error.network");
  });
});

describe("isEmbeddedIosBrowser", () => {
  const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  // WhatsApp, Instagram and Messenger all open links in a bare WKWebView, which
  // omits the Safari token. This is the case that breaks the very first invite.
  const embedded =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const chromeIos =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
  const android =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

  it("flags a bare WKWebView and nothing else", () => {
    expect(isEmbeddedIosBrowser(embedded)).toBe(true);
    expect(isEmbeddedIosBrowser(safari)).toBe(false);
    expect(isEmbeddedIosBrowser(chromeIos)).toBe(false);
    // Android WebView has the same hazard but not the same tell - it is left to
    // the runtime error rather than guessed at here.
    expect(isEmbeddedIosBrowser(android)).toBe(false);
  });
});

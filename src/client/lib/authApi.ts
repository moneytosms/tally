// The password half of auth, in one place: the three calls, the two validators,
// and the error-code mapping.
//
// A password never lands in state that outlives the submit, is never logged, and
// is never put in a query cache - only the resulting `Me` body is.
//
// The RAW password never leaves this file either: every call below runs it
// through `deriveAuthKey` first, and the server only ever sees the derived key.
// See src/shared/password-kdf.ts for why the stretching happens here.
import { ApiError, api } from "~/client/lib/api";
import type { Me } from "~/client/lib/queries";
import { deriveAuthKey } from "~/shared/password-kdf";
import { emailSchema, passwordSchema } from "~/shared/schemas";

/** `ledgerId` is the ledger a LEDGER invite joined them to, and null for an
 *  instance invite. The invite is already consumed by this call - the caller
 *  must NOT also POST /api/invites/:token/accept. */
export type SignUpResult = Me & { ledgerId: string | null };

export const signUp = async (body: {
  inviteToken: string;
  displayName: string;
  email: string;
  password: string;
}): Promise<SignUpResult> =>
  api<SignUpResult>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ ...body, password: await deriveAuthKey(body.password, body.email) }),
  });

export const signInWithPassword = async (body: { email: string; password: string }): Promise<Me> =>
  api<Me>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ ...body, password: await deriveAuthKey(body.password, body.email) }),
  });

/**
 * `email` is ALWAYS the account's sign-in address - the one it already has, or
 * the one being claimed. It has to be, because it is the KDF salt; the server
 * ignores it once an address is set, so passing it is harmless either way.
 * `currentPassword` is required only once a password exists.
 */
export const setPassword = async (body: {
  email: string;
  currentPassword?: string;
  password: string;
}): Promise<Me> =>
  api<Me>("/api/me/password", {
    method: "POST",
    body: JSON.stringify({
      email: body.email,
      password: await deriveAuthKey(body.password, body.email),
      // Derived with the SAME salt: it is the same account's password.
      ...(body.currentPassword === undefined
        ? {}
        : { currentPassword: await deriveAuthKey(body.currentPassword, body.email) }),
    }),
  });

/** i18n key for what is wrong with this address, or null. Empty is its own
 *  message: "enter an email" reads as an instruction, "that isn't an email"
 *  reads as an accusation about a field they never touched. */
export function emailProblem(email: string): string | null {
  if (email.trim() === "") return "onboarding.emailRequired";
  return emailSchema.safeParse(email).success ? null : "onboarding.emailInvalid";
}

/** Same, for a password being CHOSEN. Sign-in only needs non-empty - an old
 *  short password must still be able to sign in and then be changed. */
export function newPasswordProblem(password: string): string | null {
  if (password === "") return "onboarding.passwordRequired";
  // The length lives in the shared schema; restating 10 here would let the two drift.
  return passwordSchema.safeParse(password).success ? null : "onboarding.passwordTooShort";
}

/**
 * Server error -> i18n key, for every password surface.
 *
 * `fallback` is what an unrecognised failure says, because "could not sign in"
 * and "could not save that password" are different sentences. 401 is deliberately
 * not handled here: only the caller knows whether it means bad credentials or a
 * lost session.
 */
export function passwordErrorKey(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  if (e.code === "offline") return "error.network";
  if (e.code === "email_taken") return "onboarding.emailTaken";
  if (e.code === "invite") return "onboarding.inviteUnusable";
  if (e.code === "credentials" && e.status === 403) return "profile.passwordWrong";
  // The client validates the same fields before submitting, so a 400 here means
  // the address passed our check and failed the server's - the one field it can be.
  if (e.status === 400) return "onboarding.emailInvalid";
  if (e.status >= 500) return "onboarding.errorServer";
  return fallback;
}

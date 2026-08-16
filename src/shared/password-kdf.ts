// Client-side key stretching. The browser does the expensive half of password
// hashing; the Worker does a cheap second pass over the result.
//
// WHY THIS EXISTS: the instance runs on the Cloudflare Workers FREE plan, which
// allows ~10ms of CPU per invocation. A password hash worth the name costs far
// more than that - PBKDF2 at 64k iterations measured ~7.5ms on its own, before
// routing, JSON and D1. Cutting the server's iteration count until it fits would
// have left a hash that a leaked database gives up in an afternoon.
//
// So the work moves to where there is CPU to spare. The browser derives an "auth
// key" from the password with 600k iterations (a few hundred ms once, at
// sign-in), sends THAT instead of the password, and the Worker stores a cheap
// PBKDF2 over it. An attacker with the database still has to pay the full
// 600k + server iterations per guess, because the auth key is what they must
// produce and the only way to it is through the client KDF.
//
// The salt is the email address, so it is derivable before the account exists
// and identical on every device. That is why email is immutable in this app: a
// changed address would silently invalidate the password (ADR 0006).
//
// Consequences to keep in mind:
//   - The auth key is password-EQUIVALENT in transit. That is no worse than
//     sending the password itself, and TLS covers both.
//   - The server can no longer enforce a minimum password length; it only ever
//     sees a fixed-length key. Length is checked client-side, and the only
//     person a weakened password hurts is its owner.
//   - This is a browser-only contract. A second client would have to reproduce
//     it exactly; there is only ever one, so it lives here rather than in a spec.

/** Cost paid by the browser. Raise freely - it never touches the CPU budget. */
export const CLIENT_KDF_ITERATIONS = 600_000;

/** Versioned so the scheme can change later without colliding with old keys. */
const SALT_PREFIX = "tally:auth:v1:";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The value sent to the server in place of the password.
 *
 * `email` is normalised the same way `emailSchema` normalises it, so a capital
 * letter typed on one device cannot produce a different key from the same
 * password on another.
 */
export async function deriveAuthKey(password: string, email: string): Promise<string> {
  const salt = new TextEncoder().encode(SALT_PREFIX + email.trim().toLowerCase());
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations: CLIENT_KDF_ITERATIONS },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}

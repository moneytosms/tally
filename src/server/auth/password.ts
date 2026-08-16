// Password hashing on Workers.
//
// PBKDF2-SHA256 via WebCrypto, because that is what the runtime actually has -
// there is no bcrypt/argon2 in workerd without pulling in WASM, and a WASM
// hasher is a large dependency for a twenty-person instance.
//
// The iteration count is STORED IN THE HASH STRING. That is the whole reason
// the format has fields: raising the cost later must not invalidate the
// passwords already on the instance, and comparing against an old hash has to
// use the count that produced it.
//
// CPU budget: this instance runs on the Workers FREE plan, which allows ~10ms of
// CPU per invocation. PBKDF2 is deliberately the opposite of cheap - measured on
// the dev machine, 64k iterations alone costs ~7.5ms, leaving nothing for
// routing, JSON and D1. So the count here is small ON PURPOSE.
//
// The strength does not come from this pass. It comes from the browser, which
// derives an auth key with 600k iterations BEFORE calling; what arrives as
// `password` is already that key. An attacker holding a leaked database must
// still pay 600k + this count per guess. See src/shared/password-kdf.ts.
//
// The count is stored per-hash, so raising it later (say, on the paid plan)
// leaves every existing password working.
//
// Never log a password, a hash, or a salt.
import { base64url, timingSafeEqual } from "~/server/auth/session";

/** ~1.3ms on the dev machine. Sized to fit the free plan's 10ms ceiling with
 *  room left for the rest of the request, NOT to be a hash cost on its own. */
const ITERATIONS = 10_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

/** Minimum length. Length is the only password rule here - composition rules
 *  push people towards `Passw0rd!` and buy nothing.
 *
 *  Enforced CLIENT-side only: by the time a request reaches this file the
 *  password has already been through the browser KDF and is a fixed-length key.
 *  The only account a short password weakens is its own owner's. */
export const MIN_PASSWORD_LENGTH = 10;

function decodeBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return base64url(new Uint8Array(bits));
}

/** `pbkdf2$sha256$<iterations>$<salt>$<hash>`, both parts base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${base64url(salt)}$${hash}`;
}

/**
 * Constant-time compare against a stored hash. Returns false rather than
 * throwing on a malformed or null stored value - a caller must not be able to
 * tell "no password set" apart from "wrong password", which is why the route
 * above this still runs a dummy verify for unknown accounts.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, digest, rawIterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || digest !== "sha256" || !salt || !hash) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  try {
    const computed = await derive(password, decodeBase64url(salt), iterations);
    return timingSafeEqual(computed, hash);
  } catch {
    return false;
  }
}

// Server-side sessions in D1. The plaintext token is returned to the client
// exactly once (in the Set-Cookie header) and is never stored or logged -
// only its SHA-256 hash goes to the database.
import { uuidv7 } from "~/shared/id";
import type { SessionUser } from "~/server/context";

export const SESSION_COOKIE = "tally_session";

const DAY_MS = 86_400_000;
export const SESSION_TTL_MS = 30 * DAY_MS;
/** Sliding window granularity: don't write on every request, only once a day. */
const REFRESH_AFTER_MS = DAY_MS;

// ---- crypto helpers (shared with webauthn.ts / bootstrap) -------------------

/** 256 bits from the platform CSPRNG, base64url. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent constant-time compare of two ASCII strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---- data-access port ------------------------------------------------------

/** The subset of `Db` this module needs. Method names match `~/db`. */
export type SessionStore = {
  insertSession(row: {
    id: string;
    tokenHash: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt: number;
    userAgent: string | null;
  }): PromiseLike<unknown>;
  /** Unexpired session joined to its live user, or undefined. */
  findSessionByTokenHash(
    tokenHash: string,
    now: number,
  ): Promise<
    | {
        session: { id: string; expiresAt: number; lastSeenAt: number };
        user: { id: string; displayName: string; isOwner: boolean };
      }
    | undefined
  >;
  /** Slides the window: BOTH lastSeenAt and expiresAt must be written. */
  touchSession(id: string, at: number, expiresAt: number): PromiseLike<unknown>;
  deleteSessionByTokenHash(tokenHash: string): PromiseLike<unknown>;
};

// ---- operations ------------------------------------------------------------

/** Creates a session row and returns the plaintext token - the only time it exists. */
export async function createSession(
  store: SessionStore,
  userId: string,
  now: number,
  userAgent: string | null = null,
): Promise<string> {
  const token = randomToken();
  await store.insertSession({
    id: uuidv7(),
    tokenHash: await sha256Hex(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    userAgent,
  });
  return token;
}

/** Resolves a cookie token to its user, sliding the window at most once a day. */
export async function resolveSession(
  store: SessionStore,
  token: string,
  now: number,
): Promise<SessionUser | null> {
  const row = await store.findSessionByTokenHash(await sha256Hex(token), now);
  if (!row || row.session.expiresAt <= now) return null;
  if (now - row.session.lastSeenAt > REFRESH_AFTER_MS) {
    await store.touchSession(row.session.id, now, now + SESSION_TTL_MS);
  }
  // built explicitly - never spread a user row into a response (SPEC §7)
  return {
    id: row.user.id,
    displayName: row.user.displayName,
    isOwner: row.user.isOwner,
  };
}

/** Logout / per-device revocation: one row delete. */
export async function destroySession(
  store: SessionStore,
  token: string,
): Promise<void> {
  await store.deleteSessionByTokenHash(await sha256Hex(token));
}

// ---- cookie ----------------------------------------------------------------

// Host-only (no Domain attribute) so the cookie can never leak to a sibling
// host on the shared workers.dev suffix.
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

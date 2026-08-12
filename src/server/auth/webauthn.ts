// Passkeys. Thin wrappers over SimpleWebAuthn v13.
//
// Multiple credentials per user from day one. Recovery REVOKES the lost
// credential (revokedAt) rather than only adding a new one - enforced here,
// so no caller can authenticate a revoked credential.
//
// The challenge is server-generated, single-use and time-limited. It lives in a
// short-lived signed HttpOnly cookie rather than a table: the schema is frozen
// this pass, and a cookie needs no cleanup job. Signed with BOOTSTRAP_SECRET.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { ORIGIN, RP_ID } from "~/shared/rp-id";
import { uuidv7 } from "~/shared/id";
import { base64url, timingSafeEqual } from "~/server/auth/session";

const RP_NAME = "tally";
export const CHALLENGE_COOKIE = "tally_challenge";
const CHALLENGE_TTL_MS = 5 * 60_000;

// ---- data-access port ------------------------------------------------------

export type CredentialRow = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string; // base64url COSE key
  counter: number;
  transports: string | null; // JSON array
  revokedAt: number | null;
};

/** The subset of `Db` this module needs. Method names match `~/db`. */
export type CredentialStore = {
  /** Non-revoked credentials for one user. */
  listCredentials(userId: string): Promise<CredentialRow[]>;
  /** Lookup by the WebAuthn credential id. Revoked rows are excluded there too;
   *  this module re-checks so the rule cannot be lost if that ever changes. */
  findCredential(credentialId: string): Promise<CredentialRow | undefined>;
  insertCredential(row: {
    id: string;
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string | null;
    backedUp: boolean;
    createdAt: number;
  }): PromiseLike<unknown>;
  touchCredential(id: string, counter: number, at: number): PromiseLike<unknown>;
  revokeCredential(id: string, at: number): PromiseLike<unknown>;
};

// ---- signed challenge cookie ----------------------------------------------

type Purpose = "register" | "authenticate";

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64url(new Uint8Array(mac));
}

async function sealChallenge(
  secret: string,
  purpose: Purpose,
  challenge: string,
  now: number,
): Promise<string> {
  const payload = `${purpose}.${challenge}.${now + CHALLENGE_TTL_MS}`;
  return `${payload}.${await sign(secret, payload)}`;
}

async function openChallenge(
  secret: string,
  purpose: Purpose,
  sealed: string | undefined,
  now: number,
): Promise<string> {
  const parts = sealed?.split(".");
  if (parts?.length !== 4) throw new Error("challenge missing");
  const [gotPurpose, challenge, expiresAt, mac] = parts as [
    string,
    string,
    string,
    string,
  ];
  const payload = `${gotPurpose}.${challenge}.${expiresAt}`;
  if (!timingSafeEqual(mac, await sign(secret, payload))) {
    throw new Error("challenge signature invalid");
  }
  if (gotPurpose !== purpose) throw new Error("challenge purpose mismatch");
  if (Number(expiresAt) <= now) throw new Error("challenge expired");
  return challenge;
}

/** Single-use: the caller clears the cookie as soon as verification is attempted. */
export function challengeCookie(sealed: string): string {
  const maxAge = Math.floor(CHALLENGE_TTL_MS / 1000);
  return `${CHALLENGE_COOKIE}=${sealed}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// ---- registration ----------------------------------------------------------

export async function registrationOptions(
  store: CredentialStore,
  secret: string,
  user: { id: string; displayName: string },
  now: number,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; cookie: string }> {
  const existing = await store.listCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.displayName,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.displayName,
    // an authenticator already registered to this user must not be re-enrolled
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  return {
    options,
    cookie: challengeCookie(
      await sealChallenge(secret, "register", options.challenge, now),
    ),
  };
}

export async function verifyRegistration(
  store: CredentialStore,
  secret: string,
  args: {
    userId: string;
    response: RegistrationResponseJSON;
    sealedChallenge: string | undefined;
    now: number;
  },
): Promise<{ credentialId: string }> {
  const expectedChallenge = await openChallenge(
    secret,
    "register",
    args.sealedChallenge,
    args.now,
  );
  const result = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!result.verified) throw new Error("registration failed");

  const { credential, credentialBackedUp } = result.registrationInfo;
  await store.insertCredential({
    id: uuidv7(),
    userId: args.userId,
    credentialId: credential.id,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports
      ? JSON.stringify(credential.transports)
      : null,
    backedUp: credentialBackedUp,
    createdAt: args.now,
  });
  return { credentialId: credential.id };
}

// ---- authentication --------------------------------------------------------

/** Discoverable credentials: no allowCredentials, so no user enumeration. */
export async function authenticationOptions(
  secret: string,
  now: number,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; cookie: string }> {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });
  return {
    options,
    cookie: challengeCookie(
      await sealChallenge(secret, "authenticate", options.challenge, now),
    ),
  };
}

export async function verifyAuthentication(
  store: CredentialStore,
  secret: string,
  args: {
    response: AuthenticationResponseJSON;
    sealedChallenge: string | undefined;
    now: number;
  },
): Promise<{ userId: string }> {
  const expectedChallenge = await openChallenge(
    secret,
    "authenticate",
    args.sealedChallenge,
    args.now,
  );
  const row = await store.findCredential(args.response.id);
  if (!row) throw new Error("unknown credential");
  // a revoked credential never authenticates - checked here, not in callers
  if (row.revokedAt !== null) throw new Error("credential revoked");

  const result = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: row.credentialId,
      publicKey: fromBase64url(row.publicKey),
      counter: row.counter,
      transports: parseTransports(row.transports),
    },
  });
  if (!result.verified) throw new Error("authentication failed");

  await store.touchCredential(
    row.id,
    result.authenticationInfo.newCounter,
    args.now,
  );
  return { userId: row.userId };
}

// ---- recovery --------------------------------------------------------------

/** Owner-initiated recovery: revoke the lost credential. `id` is the credentials
 *  row id, as listed by `listCredentials(userId)`. Idempotent. */
export async function revokeCredential(
  store: CredentialStore,
  id: string,
  now: number,
): Promise<void> {
  await store.revokeCredential(id, now);
}

// ---- codecs ----------------------------------------------------------------

function parseTransports(
  json: string | null,
): AuthenticatorTransportFuture[] | undefined {
  return json ? (JSON.parse(json) as AuthenticatorTransportFuture[]) : undefined;
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Web Push, on WebCrypto only.
//
// There is no dependency for this: the `web-push` package is Node-only (it
// reaches for `crypto.createECDH`) and does not run on Workers. What follows is
// RFC 8291 payload encryption (`aes128gcm`) plus RFC 8292 VAPID, both of which
// WebCrypto covers natively.
//
// SPEC §9: push has exactly two triggers and both are single-recipient. Nothing
// here loops over more than one user's subscriptions, which is what keeps the
// 10 ms CPU ceiling off the risk list. Keep it that way.
//
// The crypto is exercised end-to-end in push.test.ts by decrypting what
// `encryptPayload` produces with the recipient's private key. If you change
// anything in here and that test still passes, the change is safe; if you are
// tempted to change it so the test passes, you have broken interoperability
// with real push services instead.

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string; // base64url, uncompressed P-256 point (65 bytes)
  auth: string; // base64url, 16-byte auth secret
};

export type PushMessage = { title: string; body: string; url?: string };

// ---- base64url ------------------------------------------------------------

export function b64urlToBytes(s: string): Uint8Array {
  const body = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Accepts either alphabet — `web-push` emits base64url, but a hand-pasted key
 *  is often standard base64, and a JWK `d` value must be base64url. */
const toB64url = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function bytesToB64url(b: Uint8Array): string {
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- HKDF (RFC 5869), as the push spec uses it ----------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---- RFC 8291 payload encryption ------------------------------------------

/**
 * Encrypt `plaintext` for one subscription, producing an `aes128gcm` body.
 *
 * Layout (RFC 8188 §2.1):
 *   salt (16) | record size (4, big-endian) | key id length (1) | key id (65) | ciphertext
 *
 * `salt` and the ephemeral key are random per message, so encrypting the same
 * text twice gives different bytes. That is required, not incidental.
 */
export async function encryptPayload(
  sub: PushSubscriptionKeys,
  plaintext: Uint8Array,
  // Injectable purely so the test can pin them and assert exact bytes.
  fixed?: { salt: Uint8Array; keyPair: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asKeys =
    fixed?.keyPair ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // RFC 8291 §3.4: the auth secret is the salt for the first extract, and the
  // info binds both public keys so a swapped key cannot decrypt.
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // 0x02 is the last-record delimiter. A single record means there is never a
  // continuation, so it is always 0x02 and never 0x01.
  const padded = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, padded as BufferSource),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---- RFC 8292 VAPID -------------------------------------------------------

/**
 * Import a VAPID keypair as generated by `npx web-push generate-vapid-keys`:
 * the public key is a base64url uncompressed P-256 point, the private key is
 * the base64url 32-byte scalar. WebCrypto will only take them together, as a
 * JWK, so x and y are recovered from the public point.
 */
async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key is not an uncompressed P-256 point");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(pub.subarray(1, 33)),
      y: bytesToB64url(pub.subarray(33, 65)),
      d: toB64url(privateKey),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * A signed VAPID JWT for one push endpoint's origin.
 *
 * `aud` is the ORIGIN of the endpoint, not the full URL — sending the full URL
 * is the single most common reason a push service answers 401.
 */
export async function vapidHeaders(
  endpoint: string,
  keys: { publicKey: string; privateKey: string; subject: string },
  now: number,
): Promise<{ Authorization: string }> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // 12 hours. The spec caps it at 24; staying well under avoids clock-skew 401s.
  const exp = Math.floor(now / 1000) + 12 * 60 * 60;
  const payload = bytesToB64url(utf8(JSON.stringify({ aud, exp, sub: keys.subject })));
  const signingInput = `${header}.${payload}`;

  const key = await importVapidKey(keys.publicKey, keys.privateKey);
  // WebCrypto emits raw r||s, which is exactly what JWS ES256 wants — no DER
  // unwrapping needed.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput) as BufferSource),
  );
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${keys.publicKey}` };
}

// ---- sending --------------------------------------------------------------

export type SendResult = { ok: boolean; status: number; gone: boolean };

/**
 * Deliver one message to one subscription.
 *
 * `gone` is the caller's signal to stop using this subscription: 404 and 410
 * both mean the browser threw it away. Anything else — including a 429 or a 5xx
 * — is transient and the row is left alone. Push is best-effort; a failure here
 * never fails the user action that triggered it.
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  message: PushMessage,
  keys: { publicKey: string; privateKey: string; subject: string },
  now: number = Date.now(),
): Promise<SendResult> {
  const body = await encryptPayload(sub, utf8(JSON.stringify(message)));
  const auth = await vapidHeaders(sub.endpoint, keys, now);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: body as BodyInit,
  });

  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

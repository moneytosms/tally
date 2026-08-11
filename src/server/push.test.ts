// The point of this file is the round-trip: encrypt as the server, then decrypt
// as the browser would, using the recipient's private key and the RFC 8291
// derivation done independently below. If `encryptPayload` and this decrypt
// agree, the bytes on the wire are the bytes a real push service will accept.
//
// Deriving the keys twice from the same helper would prove nothing, so the
// decrypt side spells out its own HKDF rather than importing the server's.
import { describe, expect, it } from "vitest";
import { b64urlToBytes, bytesToB64url, encryptPayload, sendPush, vapidHeaders } from "~/server/push";

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

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      key,
      length * 8,
    ),
  );
}

/** A browser's subscription: an ECDH keypair plus a random auth secret. */
async function makeSubscription(endpoint = "https://push.example.com/send/abc") {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { endpoint, p256dh: bytesToB64url(pub), auth: bytesToB64url(auth) },
    privateKey: kp.privateKey,
    publicRaw: pub,
    authSecret: auth,
  };
}

/** The receiving half of RFC 8291, written out independently. */
async function decrypt(
  body: Uint8Array,
  recipient: { privateKey: CryptoKey; publicRaw: Uint8Array; authSecret: Uint8Array },
): Promise<string> {
  const salt = body.subarray(0, 16);
  const idLen = body[20]!;
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);

  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, recipient.privateKey, 256),
  );

  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), recipient.publicRaw, asPublic);
  const ikm = await hkdf(recipient.authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, ciphertext as BufferSource),
  );
  // strip the 0x02 last-record delimiter
  return new TextDecoder().decode(plain.subarray(0, plain.length - 1));
}

describe("base64url", () => {
  it("round-trips every byte value", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(b64urlToBytes(bytesToB64url(all)))).toEqual(Array.from(all));
  });

  it("emits no padding and no + or /", () => {
    const s = bytesToB64url(new Uint8Array([251, 255, 190, 239]));
    expect(s).not.toMatch(/[+/=]/);
  });

  it("decodes each unpadded length correctly", () => {
    for (const n of [1, 2, 3, 4, 5, 16, 32, 65]) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(Array.from(b64urlToBytes(bytesToB64url(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe("encryptPayload", () => {
  it("produces a body the recipient can decrypt", async () => {
    const r = await makeSubscription();
    const message = JSON.stringify({ title: "Bob settled with you", body: "₹450 in Goa" });
    const body = await encryptPayload(r.sub, utf8(message));
    expect(await decrypt(body, r)).toBe(message);
  });

  it("lays the header out as RFC 8188 requires", async () => {
    const r = await makeSubscription();
    const body = await encryptPayload(r.sub, utf8("x"));
    expect(body.length).toBeGreaterThan(21 + 65);
    // record size, big-endian, at offset 16
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16, false)).toBe(4096);
    expect(body[20]).toBe(65); // key id length
    expect(body[21]).toBe(4); // uncompressed point marker
  });

  it("gives different bytes each time, because salt and key are per-message", async () => {
    const r = await makeSubscription();
    const a = await encryptPayload(r.sub, utf8("same"));
    const b = await encryptPayload(r.sub, utf8("same"));
    expect(bytesToB64url(a)).not.toBe(bytesToB64url(b));
    // ...and both still decrypt
    expect(await decrypt(a, r)).toBe("same");
    expect(await decrypt(b, r)).toBe("same");
  });

  it("cannot be decrypted with a different subscription's key", async () => {
    const r = await makeSubscription();
    const other = await makeSubscription();
    const body = await encryptPayload(r.sub, utf8("secret"));
    await expect(decrypt(body, other)).rejects.toThrow();
  });

  it("handles a multi-byte UTF-8 payload", async () => {
    const r = await makeSubscription();
    const message = "Priya settled ₹1,240 — “Goa trip” 🎉";
    expect(await decrypt(await encryptPayload(r.sub, utf8(message)), r)).toBe(message);
  });

  it("handles an empty payload", async () => {
    const r = await makeSubscription();
    expect(await decrypt(await encryptPayload(r.sub, utf8("")), r)).toBe("");
  });
});

describe("vapidHeaders", () => {
  // A real keypair in the shape `web-push generate-vapid-keys` emits.
  async function vapidKeys() {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    return { publicKey: bytesToB64url(pub), privateKey: jwk.d!, verify: kp.publicKey, subject: "mailto:a@b.c" };
  }

  it("signs a JWT the matching public key verifies", async () => {
    const k = await vapidKeys();
    const { Authorization } = await vapidHeaders("https://push.example.com/send/abc", k, 1_760_000_000_000);
    const jwt = /vapid t=([^,]+), k=(.+)$/.exec(Authorization)![1]!;
    const [h, p, s] = jwt.split(".");
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      k.verify,
      b64urlToBytes(s!) as BufferSource,
      utf8(`${h}.${p}`) as BufferSource,
    );
    expect(ok).toBe(true);
  });

  it("uses the endpoint ORIGIN as aud, not the full URL", async () => {
    const k = await vapidKeys();
    const { Authorization } = await vapidHeaders("https://push.example.com/send/abc?x=1", k, 1_760_000_000_000);
    const jwt = /vapid t=([^,]+),/.exec(Authorization)![1]!;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(jwt.split(".")[1]!)));
    expect(claims.aud).toBe("https://push.example.com");
    expect(claims.sub).toBe("mailto:a@b.c");
  });

  it("sets an expiry inside the 24h cap", async () => {
    const k = await vapidKeys();
    const now = 1_760_000_000_000;
    const { Authorization } = await vapidHeaders("https://push.example.com/x", k, now);
    const jwt = /vapid t=([^,]+),/.exec(Authorization)![1]!;
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlToBytes(jwt.split(".")[1]!)));
    expect(exp).toBeGreaterThan(now / 1000);
    expect(exp - now / 1000).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it("carries the public key in the k parameter", async () => {
    const k = await vapidKeys();
    const { Authorization } = await vapidHeaders("https://push.example.com/x", k, 1_760_000_000_000);
    expect(Authorization.endsWith(`k=${k.publicKey}`)).toBe(true);
  });

  it("rejects a public key that is not an uncompressed P-256 point", async () => {
    await expect(
      vapidHeaders("https://push.example.com/x", {
        publicKey: bytesToB64url(new Uint8Array(10)),
        privateKey: "x",
        subject: "mailto:a@b.c",
      }, 0),
    ).rejects.toThrow(/uncompressed P-256 point/);
  });
});

describe("sendPush", () => {
  it("reports 410 as gone, so the caller retires the subscription", async () => {
    const r = await makeSubscription();
    const k = await (async () => {
      const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
      const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
      const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
      return { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: "mailto:a@b.c" };
    })();

    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(null, { status: 410 })) as typeof fetch;
      const res = await sendPush(r.sub, { title: "t", body: "b" }, k);
      expect(res).toEqual({ ok: false, status: 410, gone: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not treat a 429 as gone", async () => {
    const r = await makeSubscription();
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const k = { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: "mailto:a@b.c" };

    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
      const res = await sendPush(r.sub, { title: "t", body: "b" }, k);
      expect(res.gone).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("sends the aes128gcm content encoding and a VAPID authorization", async () => {
    const r = await makeSubscription();
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const k = { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: "mailto:a@b.c" };

    const original = globalThis.fetch;
    let seen: Request | undefined;
    try {
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        seen = new Request(url, init);
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;
      await sendPush(r.sub, { title: "t", body: "b" }, k);
    } finally {
      globalThis.fetch = original;
    }
    expect(seen!.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(seen!.headers.get("Authorization")).toMatch(/^vapid t=.+, k=.+$/);
    // and the encrypted body really is what the recipient expects
    expect(await decrypt(new Uint8Array(await seen!.arrayBuffer()), r)).toBe(
      JSON.stringify({ title: "t", body: "b" }),
    );
  });
});

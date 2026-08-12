// UUIDv7 - time-ordered so ids sort by creation. RFC 9562 method 2: the 12-bit
// rand_a field is a per-millisecond counter, which keeps ids monotonic within a tick.
let lastMs = 0;
let seq = 0;

export function uuidv7(): string {
  const ms = Date.now();
  if (ms === lastMs) seq = (seq + 1) & 0xfff;
  else ((lastMs = ms), (seq = 0));

  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = (ms / 2 ** (40 - i * 8)) & 0xff;
  b[6] = 0x70 | (seq >> 8); // version 7 + counter high nibble
  b[7] = seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80; // variant

  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Procedural score + SFX for the tally launch film. Pure JS, no samples, no downloads.
// Raag Bhupali (S R G P D) over a tanpura-like drone, santoor-ish plucks, soft tabla-ish thumps,
// and SFX placed from timeline.cjs so picture and sound stay locked.
// Output: video/out/music.wav (44.1 kHz, 16-bit stereo).  Original work, MIT like the rest of the repo.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const T = require('./timeline.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));

const SR = 44100;
const TAIL = 0.4;
const N = Math.ceil((T.dur + TAIL) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const BPM = 88, BEAT = 60 / BPM;

let rs = 12345;
const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const SA = 146.83; // D3
const hz = (semi, base = SA) => base * Math.pow(2, semi / 12);
const TWO_PI = Math.PI * 2;

function add(t, buf, gL = 1, gR = 1) {
  const i0 = Math.round(t * SR);
  for (let i = 0; i < buf.length; i++) {
    const k = i0 + i;
    if (k < 0 || k >= N) continue;
    L[k] += buf[i] * gL; R[k] += buf[i] * gR;
  }
}
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

/* ---- voices ---- */
// plucked string (Karplus-Strong, two detuned strings like a santoor course)
function pluck(f, dur, vel = 1, bright = 0.5) {
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  for (const det of [1, 1.0028]) {
    const len = Math.max(2, Math.round(SR / (f * det)));
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = rnd() * (0.5 + bright * 0.5);
    // soften the excitation
    for (let k = 0; k < 4; k++) for (let i = 1; i < len; i++) d[i] = 0.5 * (d[i] + d[i - 1]);
    let idx = 0, prev = 0;
    const damp = 0.5 + 0.5 * bright * 0.6;
    for (let i = 0; i < n; i++) {
      const cur = d[idx], nxt = d[(idx + 1) % len];
      const v = (cur * damp + nxt * (1 - damp)) * 0.9965;
      d[idx] = v; idx = (idx + 1) % len;
      const env = Math.min(1, i / 60) * Math.exp(-i / (SR * dur * 0.55));
      out[i] += cur * 0.5 * vel * env;
    }
  }
  let lp = 0; const a = 1 - Math.exp(-TWO_PI * 3600 / SR);
  for (let i = 0; i < n; i++) { lp += (out[i] - lp) * a; out[i] = lp * 1.6; }
  return out;
}
// tanpura-ish: bright additive string with slow beating partials (jivari buzz)
function tanpura(f, dur, vel = 1) {
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  for (let h = 1; h <= 14; h++) {
    const amp = vel * 0.5 / Math.pow(h, 0.9) * (h > 6 ? 1.6 : 1) * (h === 5 ? 1.2 : 1);
    const beat = 0.15 + h * 0.07, ph = rnd() * 6;
    const dec = dur * (0.9 - h * 0.035);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const a = Math.min(1, t / 0.02) * Math.exp(-t / dec);
      out[i] += Math.sin(TWO_PI * f * h * t + ph) * amp * a * (0.75 + 0.25 * Math.sin(TWO_PI * beat * t + ph));
    }
  }
  return out;
}
function tabla(f0 = 150, f1 = 72, dur = 0.5, vel = 1) {
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t * 14);
    ph += TWO_PI * f / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 7);
    out[i] = (Math.sin(ph) + 0.18 * Math.sin(ph * 2.1)) * env * vel + rnd() * 0.04 * Math.exp(-t * 90) * vel;
  }
  return out;
}
function tick(f = 3800, dur = 0.05, vel = 1) { // paper click
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; lp += (rnd() - lp) * 0.6; out[i] = (lp * 0.7 + Math.sin(TWO_PI * f * t) * 0.3) * Math.exp(-t * 90) * vel; }
  return out;
}
function thump(dur = 0.28, vel = 1, f0 = 110) { // soft paper/stamp thump
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  let ph = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 48 + (f0 - 48) * Math.exp(-t * 28);
    ph += TWO_PI * f / SR;
    lp += (rnd() - lp) * 0.08;
    out[i] = (Math.sin(ph) * Math.exp(-t * 15) + lp * 0.9 * Math.exp(-t * 40)) * vel;
  }
  return out;
}
function swoosh(dur = 0.7, vel = 1) { // filtered noise
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = i / n;
    const a = Math.sin(Math.PI * x) ** 2;
    const k = 0.02 + 0.2 * x;
    lp += (rnd() - lp) * k; lp2 += (lp - lp2) * k;
    out[i] = lp2 * a * vel * 3;
  }
  return out;
}
function bell(f, dur, vel = 1) {
  const n = Math.floor(dur * SR), out = new Float32Array(n);
  for (const [r, a] of [[1, 1], [2.01, 0.4], [3.98, 0.18], [5.4, 0.08]]) for (let i = 0; i < n; i++) { const t = i / SR; out[i] += Math.sin(TWO_PI * f * r * t) * a * vel * Math.exp(-t * (2.2 + r * 0.9)) * Math.min(1, t / 0.003); }
  return out;
}

/* ---- score ---- */
const S_ = { S: 0, R: 2, G: 4, P: 7, D: 9, S2: 12, S3: 24, D2: 21, P2: 19, G2: 16, R2: 14, d: -3, p: -5, s: -12, g: -8, r: -10 };
// phrases: [beatOffset, semitone, durationBeats]
const PH = {
  A: [[0, S_.G, 1], [1, S_.P, 0.5], [1.5, S_.G, 0.5], [2, S_.R, 1], [3, S_.S, 1]],
  B: [[0, S_.R, 0.5], [0.5, S_.G, 0.5], [1, S_.P, 1], [2, S_.D, 0.5], [2.5, S_.P, 0.5], [3, S_.G, 1]],
  C: [[0, S_.D, 1], [1, S_.S2, 0.5], [1.5, S_.D, 0.5], [2, S_.P, 1], [3, S_.G, 1]],
  D: [[0, S_.S2, 0.5], [0.5, S_.D, 0.5], [1, S_.P, 0.5], [1.5, S_.G, 0.5], [2, S_.R, 0.5], [2.5, S_.G, 0.5], [3, S_.S, 1]],
  E: [[0, S_.P, 1.5], [1.5, S_.G, 0.5], [2, S_.P, 0.5], [2.5, S_.D, 0.5], [3, S_.S2, 1]],
  F: [[0, S_.S2, 0.5], [0.5, S_.R2, 0.5], [1, S_.G2, 1], [2, S_.R2, 0.5], [2.5, S_.S2, 0.5], [3, S_.D, 1]],
  H: [[0, S_.S, 2], [2, S_.P, 2]]
};
const bars = 'A B A C B E A D C F E D B F H H'.split(' ');
const mel0 = 1.2; // first melody note (s)
const barLen = 4 * BEAT;
// level envelope by section (sparse intro, fuller middle, calm end)
const lvl = (t) => (t < 4 ? 0.45 : t < 10 ? 0.7 : t < 30 ? 0.85 : t < 36 ? 0.8 : 0.7);

bars.forEach((b, bi) => {
  const t0 = mel0 + bi * barLen;
  if (t0 > T.dur - 0.5) return;
  for (const [off, semi, d] of PH[b]) {
    const t = t0 + off * BEAT;
    if (t > T.dur - 0.8) continue;
    const swing = (Math.floor(off * 2) % 2) ? 0.012 : 0;
    const octave = (t >= 24 && t < 30) ? 0 : 0;
    const f = hz(semi + 12 + octave); // D4 region
    const v = (off === 0 ? 1 : 0.8) * lvl(t);
    const [gl, gr] = pan(-0.25 + 0.5 * ((bi * 3 + Math.round(off * 2)) % 5) / 4);
    const buf = pluck(f, 2.4 + d * 0.8, 0.55 * v, 0.6);
    add(t + swing, buf, gl, gr);
    // soft echo for space
    add(t + swing + BEAT * 0.75, buf, gr * 0.28, gl * 0.28);
  }
});

// tanpura drone: Pa Sa Sa Sa(low), 4-stroke cycle, slow
const cyc = 6 / 1.0; // seconds per cycle
const droneVel = (t) => 0.5 * Math.min(1, t / 1.5);
const seq = [[hz(-5, SA), 0], [hz(0), 1.0], [hz(0), 2.0], [hz(-12), 3.0]];
for (let c = 0; c * cyc < T.dur + 1; c++) for (const [f, o] of seq) {
  const t = c * cyc + o * 1.5 * 0.9;
  if (t > T.dur) continue;
  const v = droneVel(t) * (t > 36 ? 1.1 : 1);
  add(t, tanpura(f * (f < SA ? 1 : 1), 4.5, 0.16 * v), 0.85, 0.85);
}

// tabla-ish pulse, beats 1 and 3 + a light off-beat tick, in from scene 2
for (let b = 0; b * BEAT < T.dur; b++) {
  const t = b * BEAT + 0.15;
  if (t < 4 || t > 35.6) continue;
  const bar = b % 4;
  const v = t < 10 ? 0.55 : 0.8;
  if (bar === 0) add(t, tabla(150, 70, 0.55, 0.42 * v), 1, 1);
  if (bar === 2) add(t, tabla(170, 90, 0.4, 0.28 * v), 1, 1);
  if (bar === 1 || bar === 3) add(t + BEAT * 0.5, tick(2600, 0.04, 0.05 * v), 0.8, 1.0);
}

/* ---- SFX from the shared timeline ---- */
add(T.ticketIn, swoosh(0.9, 0.12), 1, 1);
add(T.punch - 0.08, thump(0.2, 0.4, 70), 1, 1);
add(T.punch, tick(1800, 0.09, 0.75), 1, 1);          // punch click
add(T.punch, tick(5200, 0.04, 0.35), 0.6, 1);
add(T.punch + 0.02, bell(1568, 0.5, 0.07), 0.6, 0.6);
T.tally.forEach((t, i) => add(t, tick(i < 4 ? 900 : 1400, 0.045, 0.28), 1, 1));
T.billLand.forEach((t) => { add(t, thump(0.3, 0.45, 95), 1, 1); add(t - 0.55, swoosh(0.5, 0.08), 0.8, 1); });
T.billStamp.forEach((t) => add(t, thump(0.25, 0.65, 130), 1, 1));
T.chits.forEach((t, i) => add(t, tick(2800 + i * 300, 0.04, 0.2), 1, 1));
add(T.leftover, bell(1318, 0.7, 0.08), 1, 1);
add(T.coinFly[0], swoosh(0.7, 0.08), 1, 1);
add(T.coinFly[1], bell(2093, 0.9, 0.09), 1, 1);
add(T.coinFly[1], thump(0.18, 0.3, 100), 1, 1);
add(T.reconcile, bell(1568, 0.9, 0.07), 1, 1);
// kolam untangles: rising Bhupali arpeggio
[0, 2, 4, 7, 9, 12, 14, 16, 19].forEach((s, i) => {
  const t = T.arp + i * 0.1;
  const [gl, gr] = pan(-0.4 + i * 0.1);
  add(t, pluck(hz(s + 24), 1.6, 0.34 + i * 0.012, 0.8), gl, gr);
  add(t, bell(hz(s + 36), 0.9, 0.012), gl, gr);
});
add(T.morph[0], swoosh(1.8, 0.07), 1, 1);
add(T.why, bell(1760, 0.7, 0.1), 1, 1);
add(T.why, tick(3000, 0.04, 0.4), 1, 1);
T.upiStamp.forEach((t) => { add(t, thump(0.35, 0.95, 120), 1, 1); add(t, tick(900, 0.05, 0.3), 1, 1); });
T.flips.forEach((t, i) => { add(t - 0.12, tick(2200 + i * 160, 0.05, 0.4), 1, 1); add(t, thump(0.14, 0.22, 140), 1, 1); });
// end card: warm Sa-Pa-Sa' chord swell, then a few bell sparkles
[[0, 0.18], [7, 0.14], [12, 0.12], [16, 0.07]].forEach(([s, v], i) => {
  const b = pluck(hz(s + 12), 5.5, v * 3, 0.45);
  add(T.chord + i * 0.06, b, 0.9, 0.9);
});
[19, 16, 12, 9].forEach((s, i) => add(T.widen[1] - 0.2 + i * 0.28, bell(hz(s + 36), 1.4, 0.05), 0.9, 0.9));
add(T.widen[0], swoosh(2.2, 0.1), 1, 1);
add(38.7, thump(0.3, 0.5, 90), 1, 1);

/* ---- space: simple stereo comb reverb on the whole bus ---- */
function reverb(buf, amt) {
  const taps = [[0.029, 0.42], [0.037, 0.36], [0.041, 0.32], [0.053, 0.27], [0.071, 0.21], [0.097, 0.15]];
  const out = new Float32Array(buf.length);
  for (const [d, g] of taps) {
    const k = Math.round(d * SR);
    let lp = 0;
    for (let i = k; i < buf.length; i++) { lp += (buf[i - k] - lp) * 0.35; out[i] += lp * g * amt; }
  }
  return out;
}
const wl = reverb(L, 0.42), wr = reverb(R, 0.42);
const dly = Math.round(0.011 * SR);
for (let i = 0; i < N; i++) { L[i] += wl[i]; R[i] += i >= dly ? wr[i - dly] : 0; }

/* ---- fades, loudness, limiter ---- */
const fadeIn = 1.0, fadeOut = 2.0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / fadeIn) * Math.min(1, Math.max(0, (T.dur + TAIL - t) / (fadeOut + TAIL)));
  const gg = g * g * (3 - 2 * g);
  L[i] *= gg; R[i] *= gg;
}
// high-pass at ~35 Hz to keep the low end clean
for (const ch of [L, R]) { let x1 = 0, y1 = 0; const a = Math.exp(-TWO_PI * 35 / SR); for (let i = 0; i < N; i++) { const x = ch[i]; const y = a * (y1 + x - x1); x1 = x; y1 = y; ch[i] = y; } }
// target ~ -18 LUFS: measure RMS (K-weighting skipped, gated mean) and scale, soft-limit peaks
let ss = 0, cnt = 0;
for (let i = 0; i < N; i++) { const m = 0.5 * (L[i] * L[i] + R[i] * R[i]); if (m > 1e-8) { ss += m; cnt++; } }
const rms = Math.sqrt(ss / cnt);
const targetRms = Math.pow(10, -15.8 / 20);
const gain = targetRms / rms;
const ceiling = Math.pow(10, -3 / 20);
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * gain * 0.9) / Math.tanh(0.9);
  R[i] = Math.tanh(R[i] * gain * 0.9) / Math.tanh(0.9);
}
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const norm = ceiling / pk;

const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
const outp = path.join(here, 'out', 'music.wav');
fs.writeFileSync(outp, Buffer.concat([hdr, pcm]));
console.log(`wrote ${outp}  ${(N / SR).toFixed(2)}s  peak ${(20 * Math.log10(pk * norm)).toFixed(1)} dBFS`);

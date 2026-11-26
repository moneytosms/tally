// A tiny QR encoder, build-time only: byte mode, error correction M, versions
// 1-3 (single block), which is plenty for one short URL. No dependency.
// Returns a square boolean matrix (true = dark module), without quiet zone.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] = next[j]! ^ g[j]!;
      next[j + 1] = next[j + 1]! ^ gmul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g;
}

function reedSolomon(data: number[], degree: number): number[] {
  const g = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift()!;
    rem.push(0);
    if (f) for (let i = 0; i < degree; i++) rem[i] = rem[i]! ^ gmul(g[i + 1]!, f);
  }
  return rem;
}

// Level M, one block: data codewords and error-correction codewords per version.
const SPEC: Record<number, { data: number; ec: number; remainder: number }> = {
  1: { data: 16, ec: 10, remainder: 0 },
  2: { data: 28, ec: 16, remainder: 7 },
  3: { data: 44, ec: 26, remainder: 7 },
};

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(mask: number): number {
  const data = mask; // level M = 0b00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i]!);
    lines.push(m.map((row) => row[i]!));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = line.map((x) => (x ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) {
      let at = s.indexOf(pat);
      while (at !== -1) {
        score += 40;
        at = s.indexOf(pat, at + 1);
      }
    }
  }
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = m[r]![c];
      if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) score += 3;
    }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return score;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = [1, 2, 3].find((v) => SPEC[v]!.data * 8 >= 12 + bytes.length * 8);
  if (!version) throw new Error(`qr: "${text}" is too long for the tiny encoder`);
  const { data: dataCw, ec, remainder } = SPEC[version]!;

  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0; bits.length < dataCw * 8; pad ^= 1) push(pad ? 0x11 : 0xec, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const all = [...data, ...reedSolomon(data, ec)];
  const stream: number[] = [];
  for (const cw of all) for (let i = 7; i >= 0; i--) stream.push((cw >>> i) & 1);
  for (let i = 0; i < remainder; i++) stream.push(0);

  const n = 17 + 4 * version;
  const m: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    m[r]![c] = dark;
    fn[r]![c] = true;
  };

  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(r0 + dr, c0 + dc, dark);
      }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
  if (version >= 2) {
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) set(n - 7 + dr, n - 7 + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  const placeFormat = (mask: number) => {
    const f = formatBits(mask);
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
    set(7, 8, bit(6));
    set(8, 8, bit(7));
    set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) set(8, n - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) set(n - 15 + i, 8, bit(i));
    set(n - 8, 8, true);
  };
  placeFormat(0); // reserve the format areas before placing data

  let k = 0;
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let dx = 0; dx < 2; dx++) {
        const cc = c - dx;
        if (!fn[r]![cc]) {
          m[r]![cc] = k < stream.length ? stream[k]! === 1 : false;
          k++;
        }
      }
    }
    up = !up;
  }

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const t = m.map((row) => row.slice());
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r]![c] && MASKS[mask]!(r, c)) t[r]![c] = !t[r]![c];
    const saved = m.map((row) => row.slice());
    // Format bits are part of the score, so write them into the candidate.
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) m[r]![c] = t[r]![c]!;
    placeFormat(mask);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m.map((row) => row.slice());
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) m[r]![c] = saved[r]![c]!;
  }
  return best!;
}

/** One SVG path (viewBox 0 0 size+2*quiet) of merged horizontal runs. */
export function qrPath(matrix: boolean[][], quiet = 4): { d: string; size: number } {
  const n = matrix.length;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix[r]![c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && matrix[r]![end]) end++;
      d += `M${c + quiet} ${r + quiet}h${end - c}v1h${-(end - c)}z`;
      c = end;
    }
  }
  return { d, size: n + quiet * 2 };
}

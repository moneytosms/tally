// Everything the landing shows about money is computed here, at build time,
// from src/data/ledger.json (the app's own output for the Goa trip demo ledger).
// Integer paise throughout; floats appear only in SVG geometry.
import ledger from "../../data/ledger.json";
import { qrMatrix, qrPath } from "./qr";

export const DEMO_URL = "https://tally.moneytosms.workers.dev/demo";
export const DEMO_HOST = DEMO_URL.replace(/^https:\/\//, "");

/* ---------- money formatting (display only) ---------- */

const group = new Intl.NumberFormat("en-IN");
export const money = (paise: number) => {
  const abs = Math.abs(paise);
  const rupees = (abs - (abs % 100)) / 100;
  return `₹${group.format(rupees)}.${String(abs % 100).padStart(2, "0")}`;
};
export const signed = (paise: number) => `${paise < 0 ? "−" : "+"}${money(paise)}`;
export const paiseText = (paise: number) => `${group.format(paise)} paise`;
export const label = (paise: number) => (paise < 0 ? "owes" : "owed");

/* ---------- the demo ledger ---------- */

export const members = ledger.members as string[];
export const expenses = [...ledger.expenses].sort((a, b) => a.date.localeCompare(b.date));
export const net = ledger.netPositions as Record<string, number>;
export const transfers = ledger.transfers as Array<{ from: string; to: string; amountPaise: number }>;
export const total = ledger.total;
export const ledgerName = ledger.ledger;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
if (sum(expenses.map((e) => e.amountPaise)) !== total) throw new Error("ledger total mismatch");
if (sum(Object.values(net)) !== 0) throw new Error("net positions do not sum to zero");
for (const e of expenses) if (sum(Object.values(e.shares)) !== e.amountPaise) throw new Error(`shares drift: ${e.title}`);
if (ledger.settlements.length) throw new Error("landing assumes a ledger with no settlements");

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dates = expenses.map((e) => e.date).sort();
const first = new Date(dates[0]!);
const last = new Date(dates[dates.length - 1]!);
const nb = "\u00a0";
export const dateRange =
  first.getUTCMonth() === last.getUTCMonth()
    ? `${first.getUTCDate()}–${dayFmt.format(last).replace(" ", nb)}`
    : `${dayFmt.format(first).replace(" ", nb)} – ${dayFmt.format(last).replace(" ", nb)}`;

/** One member's contributions per expense: paid minus share. Sums to their net position. */
export function trail(member: string) {
  const rows = expenses
    .map((e) => {
      const paid = e.paidBy === member ? e.amountPaise : 0;
      const share = (e.shares as Record<string, number>)[member] ?? 0;
      return { title: e.title, paid, share, delta: paid - share };
    })
    .filter((r) => r.paid || r.share);
  if (sum(rows.map((r) => r.delta)) !== net[member]) throw new Error(`trail does not reconcile: ${member}`);
  return rows;
}

/** Member pairs that owe each other something, before simplifying. */
export const owingPairs = (() => {
  const owe: Record<string, Record<string, number>> = {};
  for (const m of members) owe[m] = {};
  for (const e of expenses)
    for (const [who, share] of Object.entries(e.shares))
      if (who !== e.paidBy) owe[who]![e.paidBy] = (owe[who]![e.paidBy] ?? 0) + share;
  let n = 0;
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      if ((owe[a]![b] ?? 0) !== (owe[b]![a] ?? 0)) n++;
    }
  return n;
})();

/* ---------- the worked split on the bill ---------- */

/** Same rule as the app's resolveSplits for shares/equal: truncate, then the odd paise go to the payer, else the first participant. */
export function resolve(totalPaise: number, weights: number[], payerIndex: number) {
  const weightSum = sum(weights);
  const parts = weights.map((w) => {
    const product = totalPaise * w;
    return (product - (product % weightSum)) / weightSum;
  });
  const left = totalPaise - sum(parts);
  const absorber = payerIndex >= 0 ? payerIndex : 0;
  parts[absorber] = parts[absorber]! + left;
  return { parts, left };
}

const scooter = expenses.find((e) => e.title === "Scooter rental")!;
const scooterWho = Object.keys(scooter.shares);
const scooterWeights = [2, 1, 1];
{
  const r = resolve(scooter.amountPaise, scooterWeights, scooterWho.indexOf(scooter.paidBy));
  const seeded = Object.values(scooter.shares);
  if (r.parts.some((p, i) => p !== seeded[i])) throw new Error("scooter split no longer matches the seed");
}
export const bill = {
  title: scooter.title,
  paidBy: scooter.paidBy,
  total: scooter.amountPaise,
  date: dayFmt.format(new Date(scooter.date)),
  lines: scooterWho.map((who, i) => ({
    who,
    weight: scooterWeights[i]!,
    share: (scooter.shares as Record<string, number>)[who]!,
    payer: who === scooter.paidBy,
  })),
};

// The seed divides cleanly, so the odd-paise rule is shown on a worked example.
const odd = { title: "Chai stop", total: 10_000, who: ["Sam", "Asha", "Ravi"], paidBy: "Ravi" };
const oddR = resolve(odd.total, [1, 1, 1], odd.who.indexOf(odd.paidBy));
if (sum(oddR.parts) !== odd.total || oddR.left !== 1) throw new Error("odd-paise example drifted");
export const oddPaise = { ...odd, parts: oddR.parts, left: oddR.left, base: oddR.parts[0]! };

/* ---------- the kolam ---------- */

// Five members on a 7x7 pulli grid (spacing 80, origin 60): four corners and the
// member everyone pays, in the middle.
export const GRID = { n: 7, gap: 80, origin: 60 };
const pulli = (i: number, j: number) => [GRID.origin + i * GRID.gap, GRID.origin + j * GRID.gap] as const;
const hub = transfers[0]!.to;
const rim = members.filter((m) => m !== hub);
const rimSlots = [pulli(1, 1), pulli(5, 1), pulli(5, 5), pulli(1, 5)];
export const nodes = [
  ...rim.map((name, i) => ({ name, x: rimSlots[i]![0], y: rimSlots[i]![1] })),
  { name: hub, x: pulli(3, 3)[0], y: pulli(3, 3)[1] },
];
const at = (name: string) => nodes.find((n) => n.name === name)!;
const hubIndex = nodes.length - 1;

// K5 has an Eulerian circuit, so the whole tangle is a single closed line.
const circuit = [0, 1, 2, 3, hubIndex, 0, 2, hubIndex, 1, 3, 0];
const bow = [34, 46, 34, 46, 40, 46, 40, 46, 40, 34];
const pts: Array<[number, number]> = [];
for (let k = 0; k < circuit.length - 1; k++) {
  const a = nodes[circuit[k]!]!;
  const b = nodes[circuit[k + 1]!]!;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const sign = k % 2 === 0 ? 1 : -1;
  pts.push([a.x, a.y], [mx + (-dy / len) * bow[k]! * sign, my + (dx / len) * bow[k]! * sign]);
}
const r1 = (v: number) => Math.round(v * 10) / 10;
function closedSpline(p: Array<[number, number]>) {
  const n = p.length;
  let d = `M${r1(p[0]![0])} ${r1(p[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!;
    const p1 = p[i]!;
    const p2 = p[(i + 1) % n]!;
    const p3 = p[(i + 2) % n]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r1(c1[0]!)} ${r1(c1[1]!)} ${r1(c2[0]!)} ${r1(c2[1]!)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + "Z";
}
export const tangle = closedSpline(pts);

const maxAbs = Math.max(...Object.values(net).map(Math.abs));
const radius = (paise: number) => r1(9 + (Math.sqrt(Math.abs(paise)) / Math.sqrt(maxAbs)) * 15);
export const kolamNodes = nodes.map((n) => ({ ...n, net: net[n.name]!, r: radius(net[n.name]!) }));

// Plan legs: a gentle arc from each payer to the hub, ending at the hub's rim.
export const plan = transfers.map((t) => {
  const a = at(t.from);
  const b = at(t.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const hubR = radius(net[t.to]!);
  const fromR = radius(net[t.from]!);
  const sx = a.x + ux * (fromR + 5);
  const sy = a.y + uy * (fromR + 5);
  const ex = b.x - ux * (hubR + 9);
  const ey = b.y - uy * (hubR + 9);
  const cx = (sx + ex) / 2 + -uy * 16;
  const cy = (sy + ey) / 2 + ux * 16;
  // arrowhead tangent at the end of the quadratic
  const tx = ex - cx;
  const ty = ey - cy;
  const tl = Math.hypot(tx, ty);
  const hx = tx / tl;
  const hy = ty / tl;
  const head = `M${r1(ex - hx * 11 - hy * 6)} ${r1(ey - hy * 11 + hx * 6)}L${r1(ex)} ${r1(ey)}L${r1(ex - hx * 11 + hy * 6)} ${r1(ey - hy * 11 - hx * 6)}`;
  return { ...t, d: `M${r1(sx)} ${r1(sy)}Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}`, head, trail: trail(t.from) };
});

/* ---------- QR ---------- */

export const qr = qrPath(qrMatrix(DEMO_URL), 4);

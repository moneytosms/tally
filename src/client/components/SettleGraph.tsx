// The whole picture: members as circles, payments as curved arrows. Hand-drawn
// SVG, no layout library - a ledger is a handful of people, so a ring is clear
// and cheap, and members can be dragged apart when it tangles.
//
// Meaning is never colour alone: a node says "+₹1,500 is owed" in words, an
// edge is a sentence in its aria-label, and the selected item is shown by a
// thicker stroke and by dimming the rest. Without onSelect the graph is static
// (print): no controls, no pan, zoom or drag, same text.
// Amounts are formatted here from integer paise, so the caller
// must not render this while offline (SettleUp shows the offline message instead).
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SVGAttributes,
} from "react";
import { formatPaise } from "~/shared/money";
import { t } from "~/client/i18n";

export type Selection =
  { kind: "member"; memberId: string } | { kind: "edge"; fromMemberId: string; toMemberId: string };

type Pt = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };

const GAP = 6;
const TAP_WIDTH = 24;
const TAP_PX = 6;
const MIN_K = 1;
const MAX_K = 4;
const LINE = 14;
const LABEL_FS = 11;
const CURVE = 0.15;
const FALLBACK_WIDTH = 340;
const LABEL_T = [0.5, 0.35, 0.65, 0.25, 0.75];
const DIM = 0.25;
const NODE_MARGIN = 0.06;
const NUDGE = 16;

export type View = { k: number; x: number; y: number };
export const DEFAULT_VIEW: View = { k: 1, x: 0, y: 0 };

/** Nodes evenly on an ellipse, first at the top and clockwise. A single node sits
 *  at the centre. Pure, so the geometry is testable without a DOM. */
export function layoutNodes(ids: string[], w: number, h: number, rx = w * 0.27, ry = h * 0.27): Record<string, Pt> {
  const single = ids.length === 1;
  const out: Record<string, Pt> = {};
  ids.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / ids.length;
    out[id] = single ? { x: w / 2, y: h / 2 } : { x: w / 2 + rx * Math.cos(a), y: h / 2 + ry * Math.sin(a) };
  });
  return out;
}

/** Where a node's labels go on medium and wide boxes: radially outward. Near
 *  top/bottom they sit above/below, otherwise beside, anchored on the far side. */
export function labelAnchor(angle: number): {
  anchor: "start" | "middle" | "end";
  place: "above" | "below" | "beside";
} {
  const c = Math.cos(angle);
  if (Math.abs(c) < 0.5) return { anchor: "middle", place: Math.sin(angle) < 0 ? "above" : "below" };
  return { anchor: c > 0 ? "start" : "end", place: "beside" };
}

export type GraphBox = {
  w: number;
  h: number;
  nodeR: number;
  nameMax: number;
  rx: number;
  ry: number;
  narrow: boolean;
};

/** Box and sizes for a measured container width, 1 unit = 1 CSS px. Breakpoints
 *  follow the container, not the window, so the sidebar layout works too. */
export function graphBox(width: number, members: number): GraphBox {
  const w = Math.round(width);
  if (w < 400) {
    const h = Math.round(w * 1.25);
    const nodeR = members >= 7 ? 11 : 13;
    return { w, h, nodeR, nameMax: 9, rx: w * 0.36, ry: Math.max(40, h / 2 - (nodeR + 52)), narrow: true };
  }
  const wide = w >= 640;
  const h = wide ? Math.round(w * 0.75) : w;
  const nodeR = wide ? 18 : 16;
  // Rough width of the widest side label, so the ring leaves room for it.
  const labelW = wide ? 112 : 96;
  return {
    w,
    h,
    nodeR,
    nameMax: wide ? 16 : 12,
    rx: Math.max(24, w / 2 - 4 - (nodeR + GAP) - labelW),
    ry: Math.max(40, h / 2 - (nodeR + 40)),
    narrow: false,
  };
}

export const clip = (name: string, max = 12) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/** Keeps the content covering the box: the pan stops at the edges, zoom stays 1..4. */
export function clampView(v: View, w: number, h: number): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
  const lim = (p: number, size: number) => Math.min(0, Math.max(size - k * size, p));
  return { k, x: lim(v.x, w), y: lim(v.y, h) };
}

/** Zoom by `factor` keeping the box point `pt` fixed on screen (until a clamp applies). */
export function zoomAt(v: View, pt: Pt, factor: number, w: number, h: number): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
  const cx = (pt.x - v.x) / v.k;
  const cy = (pt.y - v.y) / v.k;
  return clampView({ k, x: pt.x - cx * k, y: pt.y - cy * k }, w, h);
}

// Curved edges: a quadratic Bezier from payer to payee, bowed to one side.

/** Control point: the chord's midpoint pushed to the left of payer -> payee (screen
 *  coords), so A->B and B->A bow apart and crossing edges fan out. */
export function curveControl(p: Pt, q: Pt): Pt {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = CURVE * len;
  return { x: (p.x + q.x) / 2 - (dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off };
}

export function pointOnCurve(p: Pt, c: Pt, q: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p.x + 2 * u * t * c.x + t * t * q.x,
    y: u * u * p.y + 2 * u * t * c.y + t * t * q.y,
  };
}

export function tangentOnCurve(p: Pt, c: Pt, q: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: 2 * u * (c.x - p.x) + 2 * t * (q.x - c.x), y: 2 * u * (c.y - p.y) + 2 * t * (q.y - c.y) };
}

/** The part of the curve outside both node circles, as its own quadratic (exact
 *  subdivision, so labels sit on the drawn line). */
export function trimCurve(p: Pt, c: Pt, q: Pt, r: number): { start: Pt; ctrl: Pt; end: Pt } {
  const N = 400;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const b = pointOnCurve(p, c, q, t);
    if (Math.hypot(b.x - p.x, b.y - p.y) >= r) {
      t0 = t;
      break;
    }
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const b = pointOnCurve(p, c, q, t);
    if (Math.hypot(b.x - q.x, b.y - q.y) >= r) {
      t1 = t;
      break;
    }
  }
  if (t1 <= t0) return { start: p, ctrl: c, end: q };
  const start = pointOnCurve(p, c, q, t0);
  const end = pointOnCurve(p, c, q, t1);
  const d = tangentOnCurve(p, c, q, t0);
  const k = (t1 - t0) / 2;
  return { start, ctrl: { x: start.x + d.x * k, y: start.y + d.y * k }, end };
}

// Edge label placement: greedy, largest first, hide what does not fit.

export type LabelIn = { key: string; amount: number; text: string; p: Pt; c: Pt; q: Pt; forced: boolean };
export type Obstacles = { rects: Rect[]; circles: (Pt & { r: number })[] };

/** Estimated box of a text run. `baseline` is the text baseline. */
export function labelBox(
  text: string,
  x: number,
  baseline: number,
  fs: number,
  anchor: "start" | "middle" | "end",
): Rect {
  const w = text.length * fs * 0.58;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const y0 = baseline - fs * 0.95;
  return { x0, y0, x1: x0 + w, y1: y0 + fs * 1.3 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function circleHitsRect(c: Pt & { r: number }, r: Rect): boolean {
  const nx = Math.min(Math.max(c.x, r.x0), r.x1);
  const ny = Math.min(Math.max(c.y, r.y0), r.y1);
  return Math.hypot(c.x - nx, c.y - ny) < c.r;
}

/** Label centre: a point on the curve at `t`, pushed `off` units along its normal. */
function labelPoint(it: LabelIn, t: number, off: number): Pt {
  const b = pointOnCurve(it.p, it.c, it.q, t);
  const d = tangentOnCurve(it.p, it.c, it.q, t);
  const len = Math.hypot(d.x, d.y) || 1;
  return { x: b.x + (-d.y / len) * off, y: b.y + (d.x / len) * off };
}

/** Places each edge label at the first candidate that is inside the box and hits
 *  no obstacle or placed label. Forced labels (selected/focused) are placed first
 *  and always get a spot; the others are null when nothing fits. */
export function placeEdgeLabels(
  items: LabelIn[],
  obs: Obstacles,
  box: { w: number; h: number },
): Record<string, Pt | null> {
  const placed: Rect[] = [];
  const out: Record<string, Pt | null> = {};
  const order = [...items].sort((a, b) => Number(b.forced) - Number(a.forced) || b.amount - a.amount);
  const boxOf = (it: LabelIn, pt: Pt) => labelBox(it.text, pt.x, pt.y + 0.35 * LABEL_FS, LABEL_FS, "middle");
  for (const it of order) {
    let chosen: Pt | null = null;
    search: for (const t of LABEL_T) {
      for (const off of [10, -10]) {
        const pt = labelPoint(it, t, off);
        const r = boxOf(it, pt);
        if (r.x0 < 0 || r.y0 < 0 || r.x1 > box.w || r.y1 > box.h) continue;
        if (obs.rects.some((o) => rectsOverlap(o, r))) continue;
        if (obs.circles.some((c) => circleHitsRect(c, r))) continue;
        if (placed.some((o) => rectsOverlap(o, r))) continue;
        chosen = pt;
        placed.push(r);
        break search;
      }
    }
    if (!chosen && it.forced) {
      chosen = labelPoint(it, 0.5, 10);
      placed.push(boxOf(it, chosen));
    }
    out[it.key] = chosen;
  }
  return out;
}

/** Words and sign for a net position. Zero is "settled", never a bare zero. */
function netText(net: number): string {
  const amount = formatPaise(Math.abs(net));
  return net > 0
    ? t("settle.graph.owed", { amount })
    : net < 0
      ? t("settle.graph.owes", { amount })
      : t("settle.graph.settled");
}

/** Side labels stack the amount and the words on separate lines: "+₹17,015.00" / "is owed". */
function netLines(text: string): string[] {
  const i = text.indexOf(" ");
  return i < 0 ? [text] : [text.slice(0, i), text.slice(i + 1)];
}

/** Field by field: a JSON compare would depend on key order. */
function sameSelection(a: Selection, b: Selection | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  if (a.kind === "member" && b.kind === "member") return a.memberId === b.memberId;
  return a.kind === "edge" && b.kind === "edge" && a.fromMemberId === b.fromMemberId && a.toMemberId === b.toMemberId;
}

/** Container width as measured by ResizeObserver; 340 where it does not exist (tests, jsdom). */
function useMeasuredWidth(ref: RefObject<HTMLDivElement | null>): number | null {
  const [w, setW] = useState<number | null>(() => (typeof ResizeObserver === "undefined" ? FALLBACK_WIDTH : null));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

type Position = { memberId: string; name: string; net: number };
type Edge = { fromMemberId: string; toMemberId: string; amount: number };
type Txt = { text: string; x: number; y: number; anchor: "start" | "middle" | "end"; strong: boolean };

const btn = {
  minHeight: 44,
  minWidth: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid var(--line-2)",
  background: "var(--paper-2)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 14,
  cursor: "pointer",
} as const;

export function SettleGraph({
  positions,
  edges,
  selected = null,
  onSelect,
  label,
}: {
  positions: Position[];
  edges: Edge[];
  selected?: Selection | null;
  onSelect?: (s: Selection | null) => void;
  label: string;
}) {
  const markerId = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const interactive = onSelect !== undefined;
  const wrapRef = useRef<HTMLDivElement>(null);
  const measured = useMeasuredWidth(wrapRef);
  const box = measured === null ? null : graphBox(measured, positions.length);
  const hasBox = box !== null;

  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [overrides, setOverrides] = useState<Record<string, { fx: number; fy: number }>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const viewRef = useRef(view);
  const ovRef = useRef(overrides);
  const boxRef = useRef(box);
  const svgRef = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    kind: "pan" | "pinch" | "node";
    view: View;
    pt: Pt;
    down: { x: number; y: number };
    dist: number;
    id: string;
    start: Pt;
  } | null>(null);
  const dragged = useRef(false);
  const captured = useRef(false);

  // Layout positions: ring by default, a moved member's fraction otherwise.
  const ids = positions.map((p) => p.memberId);
  const ring = box ? layoutNodes(ids, box.w, box.h, box.rx, box.ry) : {};
  const posOf = (id: string, b: GraphBox, ov: Record<string, { fx: number; fy: number }>): Pt => {
    const o = ov[id];
    if (o) return { x: o.fx * b.w, y: o.fy * b.h };
    return ring[id] ?? { x: b.w / 2, y: b.h / 2 };
  };

  useEffect(() => {
    boxRef.current = box;
    ovRef.current = overrides;
  });

  /** Every view change goes through here: clamped to the current box. */
  const apply = useCallback((v: View) => {
    const b = boxRef.current;
    const next = b ? clampView(v, b.w, b.h) : v;
    viewRef.current = next;
    setView(next);
  }, []);

  const v = box ? clampView(view, box.w, box.h) : view;
  const nameOf = (id: string) => positions.find((p) => p.memberId === id)?.name ?? "";
  const moved = (id: string) => overrides[id] !== undefined;

  const toggle = (s: Selection) => onSelect?.(sameSelection(s, selected) ? null : s);
  // A drag ends in a click on the same element: that is not a selection.
  const pick = (s: Selection) => {
    if (!dragged.current) toggle(s);
  };
  const keyPick = (e: KeyboardEvent, s: Selection) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(s);
    }
  };
  /** Focus on an off-screen item resets the view, so keyboard users never land out of sight. */
  const keepInView = (p: Pt) => {
    const b = boxRef.current;
    const cur = viewRef.current;
    if (!b) return;
    const sx = cur.k * p.x + cur.x;
    const sy = cur.k * p.y + cur.y;
    if (sx < 0 || sx > b.w || sy < 0 || sy > b.h) apply({ ...DEFAULT_VIEW });
  };
  /** Static graphs (print) are plain labelled images: no role, focus or handlers. */
  const control = (label: string, s: Selection, isSel: boolean, anchor: Pt, key: string): SVGAttributes<SVGGElement> =>
    onSelect
      ? {
          role: "button",
          tabIndex: 0,
          "aria-pressed": isSel,
          "aria-label": label,
          className: "settle-graph-target",
          style: { cursor: "pointer" },
          onClick: () => pick(s),
          onKeyDown: (ev: KeyboardEvent) => keyPick(ev, s),
          onFocus: () => {
            setFocusKey(key);
            keepInView(anchor);
          },
          onBlur: () => setFocusKey(null),
        }
      : { role: "img", "aria-label": label };

  // Pointer geometry: client px -> box units, using the svg's own rect.
  const toBox = (r: DOMRect, cx: number, cy: number): Pt => {
    const b = boxRef.current;
    if (!b) return { x: 0, y: 0 };
    return { x: ((cx - r.left) * b.w) / r.width, y: ((cy - r.top) * b.h) / r.height };
  };
  const begin = (svg: SVGSVGElement, memberId: string | null) => {
    const r = svg.getBoundingClientRect();
    const [a, bp] = [...ptrs.current.values()];
    const b = boxRef.current;
    if (!a || !b) {
      gesture.current = null;
      return;
    }
    const pa = toBox(r, a.x, a.y);
    if (bp) {
      const pb = toBox(r, bp.x, bp.y);
      gesture.current = {
        kind: "pinch",
        view: viewRef.current,
        pt: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
        down: { x: a.x, y: a.y },
        dist: Math.hypot(pa.x - pb.x, pa.y - pb.y),
        id: "",
        start: { x: 0, y: 0 },
      };
      dragged.current = true;
      return;
    }
    gesture.current = {
      kind: memberId ? "node" : "pan",
      view: viewRef.current,
      pt: pa,
      down: { x: a.x, y: a.y },
      dist: 0,
      id: memberId ?? "",
      start: memberId ? posOf(memberId, b, ovRef.current) : { x: 0, y: 0 },
    };
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) dragged.current = false;
    const el = (e.target as Element).closest?.("[data-member]");
    begin(e.currentTarget, el?.getAttribute("data-member") ?? null);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture.current;
    const b = boxRef.current;
    if (!g || !b) return;
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    if (ptrs.current.size === 1) {
      if (!dragged.current && Math.hypot(e.clientX - g.down.x, e.clientY - g.down.y) <= TAP_PX) return;
      dragged.current = true;
      if (!captured.current) {
        svg.setPointerCapture(e.pointerId);
        captured.current = true;
      }
      const cur = toBox(r, e.clientX, e.clientY);
      if (g.kind === "node") {
        // Content moves 1:1 with the finger at any zoom: divide the screen delta by k.
        const x = g.start.x + (cur.x - g.pt.x) / viewRef.current.k;
        const y = g.start.y + (cur.y - g.pt.y) / viewRef.current.k;
        const next = {
          ...ovRef.current,
          [g.id]: {
            fx: Math.min(1 - NODE_MARGIN, Math.max(NODE_MARGIN, x / b.w)),
            fy: Math.min(1 - NODE_MARGIN, Math.max(NODE_MARGIN, y / b.h)),
          },
        };
        ovRef.current = next;
        setOverrides(next);
        return;
      }
      apply({ k: g.view.k, x: g.view.x + cur.x - g.pt.x, y: g.view.y + cur.y - g.pt.y });
      return;
    }
    // Pinch: zoom about the start midpoint, then follow the midpoint's movement.
    const [a, bp] = [...ptrs.current.values()];
    if (!a || !bp || g.dist === 0) return;
    const pa = toBox(r, a.x, a.y);
    const pb = toBox(r, bp.x, bp.y);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const z = zoomAt(g.view, g.pt, Math.hypot(pa.x - pb.x, pa.y - pb.y) / g.dist, b.w, b.h);
    apply({ ...z, x: z.x + mid.x - g.pt.x, y: z.y + mid.y - g.pt.y });
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!ptrs.current.delete(e.pointerId)) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (ptrs.current.size === 0) {
      captured.current = false;
      gesture.current = null;
    } else {
      begin(e.currentTarget, null);
    }
  };

  // Wheel needs a native listener: React's onWheel is passive, so it cannot stop page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || viewRef.current.k > 1)) return;
      const b = boxRef.current;
      if (!b) return;
      e.preventDefault();
      const pt = toBox(el.getBoundingClientRect(), e.clientX, e.clientY);
      apply(zoomAt(viewRef.current, pt, Math.exp(-e.deltaY * 0.002), b.w, b.h));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // toBox reads only refs; apply is stable.
  }, [interactive, hasBox, apply]);

  const nudgeMember = (id: string, dx: number, dy: number) => {
    const b = boxRef.current;
    if (!b) return;
    const p = posOf(id, b, ovRef.current);
    const next = {
      ...ovRef.current,
      [id]: {
        fx: Math.min(1 - NODE_MARGIN, Math.max(NODE_MARGIN, (p.x + dx) / b.w)),
        fy: Math.min(1 - NODE_MARGIN, Math.max(NODE_MARGIN, (p.y + dy) / b.h)),
      },
    };
    ovRef.current = next;
    setOverrides(next);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const b = boxRef.current;
    const cur = viewRef.current;
    if (!b) return;
    const memberId = (e.target as Element).closest?.("[data-member]")?.getAttribute("data-member");
    const arrow = e.key.startsWith("Arrow");
    if (arrow && e.altKey && memberId) {
      e.preventDefault();
      const d = {
        ArrowLeft: [-NUDGE, 0],
        ArrowRight: [NUDGE, 0],
        ArrowUp: [0, -NUDGE],
        ArrowDown: [0, NUDGE],
      } as const;
      const [dx, dy] = d[e.key as keyof typeof d] ?? [0, 0];
      nudgeMember(memberId, dx, dy);
      return;
    }
    const centre = { x: b.w / 2, y: b.h / 2 };
    const pan = cur.k > 1 ? 20 : 0;
    let next: View | null = null;
    switch (e.key) {
      case "+":
      case "=":
        next = zoomAt(cur, centre, 1.25, b.w, b.h);
        break;
      case "-":
      case "_":
        next = zoomAt(cur, centre, 0.8, b.w, b.h);
        break;
      case "0":
        next = DEFAULT_VIEW;
        break;
      case "ArrowLeft":
        if (pan) next = { ...cur, x: cur.x + pan };
        break;
      case "ArrowRight":
        if (pan) next = { ...cur, x: cur.x - pan };
        break;
      case "ArrowUp":
        if (pan) next = { ...cur, y: cur.y + pan };
        break;
      case "ArrowDown":
        if (pan) next = { ...cur, y: cur.y - pan };
        break;
    }
    if (next) {
      e.preventDefault();
      apply(next);
    }
  };

  const zoomBy = (f: number) => {
    const b = boxRef.current;
    if (b) apply(zoomAt(viewRef.current, { x: b.w / 2, y: b.h / 2 }, f, b.w, b.h));
  };
  const resetAll = () => {
    ovRef.current = {};
    setOverrides({});
    apply({ ...DEFAULT_VIEW });
  };

  const pointer = interactive
    ? {
        onPointerDown,
        onPointerMove,
        onPointerUp: onPointerEnd,
        onPointerCancel: onPointerEnd,
        onKeyDown,
      }
    : {};

  // Everything that depends on the box: node positions, label texts, edge geometry, placement.
  const layout = (() => {
    if (!box) return null;
    const cx = box.w / 2;
    const cy = box.h / 2;
    const pos: Record<string, Pt> = {};
    for (const id of ids) pos[id] = posOf(id, box, overrides);
    const single = ids.length === 1;
    const fs = { name: 12, net: LABEL_FS };

    const texts: Record<string, Txt[]> = {};
    for (const p of positions) {
      const c = pos[p.memberId];
      if (!c) continue;
      const name = clip(p.name, box.nameMax);
      const net = netText(p.net);
      const r = box.nodeR;
      if (box.narrow) {
        // Narrow: labels above the node in the upper half, below it in the lower half.
        const lines = [name, ...netLines(net)];
        const above = c.y <= cy;
        const widest = Math.max(...lines.map((l, i) => l.length * (i === 0 ? fs.name : fs.net) * 0.58));
        const x = Math.min(box.w - widest / 2 - 2, Math.max(widest / 2 + 2, c.x));
        texts[p.memberId] = lines.map((line, i) => {
          const y = above ? c.y - r - 6 - (lines.length - 1 - i) * LINE : c.y + r + 13 + i * LINE;
          return { text: line, x, y, anchor: "middle" as const, strong: i === 0 };
        });
        continue;
      }
      // Moved members label outward from the box centre; ring members from their ring angle.
      const angle = moved(p.memberId)
        ? Math.atan2(c.y - cy, c.x - cx)
        : Math.atan2((c.y - cy) / box.ry, (c.x - cx) / box.rx);
      const { anchor, place } = single ? { anchor: "middle" as const, place: "below" as const } : labelAnchor(angle);
      const dx = anchor === "start" ? r + GAP : anchor === "end" ? -(r + GAP) : 0;
      const x = c.x + dx;
      if (place === "beside") {
        const lines = [name, ...netLines(net)];
        texts[p.memberId] = lines.map((line, i) => ({
          text: line,
          x,
          y: c.y + 3 - 7 * (lines.length - 1) + LINE * i,
          anchor,
          strong: i === 0,
        }));
      } else {
        const above = place === "above";
        texts[p.memberId] = [
          { text: name, x: c.x, y: above ? c.y - r - GAP - LINE : c.y + r + 14, anchor: "middle", strong: true },
          { text: net, x: c.x, y: above ? c.y - r - GAP : c.y + r + 28, anchor: "middle", strong: false },
        ];
      }
    }

    const nodeRects: Rect[] = [];
    for (const id of Object.keys(texts)) {
      for (const tx of texts[id] ?? []) {
        nodeRects.push(labelBox(tx.text, tx.x, tx.y, tx.strong ? fs.name : fs.net, tx.anchor));
      }
    }
    const circles = ids.flatMap((id) => (pos[id] ? [{ ...pos[id], r: box.nodeR + 4 }] : []));

    const curves: Record<string, { p: Pt; c: Pt; q: Pt; start: Pt; ctrl: Pt; end: Pt }> = {};
    const items: LabelIn[] = [];
    const selEdge = selected?.kind === "edge" ? selected : null;
    const selMember = selected?.kind === "member" ? selected.memberId : null;
    for (const e of edges) {
      const p = pos[e.fromMemberId];
      const q = pos[e.toMemberId];
      if (!p || !q) continue;
      const c = curveControl(p, q);
      const trimmed = trimCurve(p, c, q, box.nodeR);
      const key = `${e.fromMemberId}-${e.toMemberId}`;
      curves[key] = { p, c, q, ...trimmed };
      const forced =
        (selEdge !== null && selEdge.fromMemberId === e.fromMemberId && selEdge.toMemberId === e.toMemberId) ||
        focusKey === key ||
        (selMember !== null && (selMember === e.fromMemberId || selMember === e.toMemberId));
      items.push({
        key,
        amount: e.amount,
        text: t("settle.graph.edgeLabel", { amount: formatPaise(e.amount) }),
        p,
        c,
        q,
        forced,
      });
    }
    const labelPos = placeEdgeLabels(items, { rects: nodeRects, circles }, box);
    const hidden = items.filter((it) => labelPos[it.key] === null).length;
    return { pos, texts, curves, labelPos, hidden };
  })();

  const touching = (e: Edge) =>
    selected?.kind === "member" && (selected.memberId === e.fromMemberId || selected.memberId === e.toMemberId);
  const dimmed = (e: Edge) => {
    if (selected?.kind === "edge") {
      return !(selected.fromMemberId === e.fromMemberId && selected.toMemberId === e.toMemberId);
    }
    if (selected?.kind === "member") return !touching(e);
    return false;
  };

  return (
    <div>
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          maxWidth: 640,
          margin: "0 auto",
          // Reserve the box before measuring: phone-first guess until the width is known.
          aspectRatio: box
            ? `${box.w} / ${box.h}`
            : typeof window !== "undefined" && window.innerWidth < 500
              ? "1 / 1.25"
              : "1 / 1",
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "var(--paper-sunk)",
          overflow: "hidden",
        }}
      >
        {box && layout && (
          <svg
            ref={svgRef}
            role="group"
            aria-label={label}
            viewBox={`0 0 ${box.w} ${box.h}`}
            width="100%"
            height="100%"
            style={{
              display: "block",
              // Narrow view: vertical swipes scroll the page. Zoomed in: the graph owns the gesture.
              touchAction: interactive ? (v.k === 1 ? "pan-y" : "none") : undefined,
            }}
            {...pointer}
          >
            <defs>
              <marker
                id={markerId}
                markerUnits="userSpaceOnUse"
                markerWidth={10}
                markerHeight={10}
                refX={10}
                refY={5}
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" style={{ fill: "var(--ink-2)" }} />
              </marker>
            </defs>

            <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
              {edges.map((e) => {
                const key = `${e.fromMemberId}-${e.toMemberId}`;
                const cv = layout.curves[key];
                if (!cv) return null;
                const isSel =
                  selected?.kind === "edge" &&
                  selected.fromMemberId === e.fromMemberId &&
                  selected.toMemberId === e.toMemberId;
                const d = `M${cv.start.x} ${cv.start.y} Q${cv.ctrl.x} ${cv.ctrl.y} ${cv.end.x} ${cv.end.y}`;
                const lp = layout.labelPos[key];
                const sentence = t("settle.pays", { from: nameOf(e.fromMemberId), to: nameOf(e.toMemberId) });
                return (
                  <g
                    key={key}
                    opacity={dimmed(e) ? DIM : 1}
                    {...control(
                      t("settle.graph.edgeAria", { pays: sentence, amount: formatPaise(e.amount) }),
                      { kind: "edge", fromMemberId: e.fromMemberId, toMemberId: e.toMemberId },
                      isSel,
                      lp ?? pointOnCurve(cv.p, cv.c, cv.q, 0.5),
                      key,
                    )}
                  >
                    {/* Invisible wide stroke: the touch target, so a thin arrow is easy to hit. */}
                    {onSelect && <path d={d} fill="none" stroke="transparent" strokeWidth={TAP_WIDTH} />}
                    <path
                      className="settle-graph-shape"
                      d={d}
                      fill="none"
                      strokeWidth={isSel ? 4.5 : 2}
                      markerEnd={`url(#${markerId})`}
                      style={{ stroke: isSel ? "var(--ink)" : "var(--ink-3)" }}
                    />
                    {lp && (
                      <text
                        x={lp.x}
                        y={lp.y}
                        textAnchor="middle"
                        dy="0.35em"
                        fontSize={LABEL_FS}
                        paintOrder="stroke"
                        stroke="var(--paper-sunk)"
                        strokeWidth={4}
                        strokeLinejoin="round"
                        style={{ fill: "var(--ink)" }}
                        className="tnum"
                        aria-hidden="true"
                      >
                        {t("settle.graph.edgeLabel", { amount: formatPaise(e.amount) })}
                      </text>
                    )}
                  </g>
                );
              })}

              {positions.map((p) => {
                const c = layout.pos[p.memberId];
                if (!c) return null;
                const isSel = selected?.kind === "member" && selected.memberId === p.memberId;
                const text = netText(p.net);
                return (
                  <g
                    key={p.memberId}
                    data-member={p.memberId}
                    style={{ touchAction: "none" }}
                    {...control(
                      t("settle.graph.nodeAria", { name: p.name, net: text }),
                      { kind: "member", memberId: p.memberId },
                      isSel,
                      c,
                      `m-${p.memberId}`,
                    )}
                  >
                    <circle
                      className="settle-graph-shape"
                      cx={c.x}
                      cy={c.y}
                      r={box.nodeR}
                      strokeWidth={isSel ? 3.5 : 1.5}
                      style={{ fill: "var(--paper-2)", stroke: isSel ? "var(--ink)" : "var(--line-2)" }}
                    />
                    <text
                      x={c.x}
                      y={c.y}
                      dy="0.35em"
                      textAnchor="middle"
                      fontSize={LABEL_FS}
                      fontWeight={600}
                      style={{ fill: "var(--ink-2)" }}
                      aria-hidden="true"
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </text>
                    {(layout.texts[p.memberId] ?? []).map((tx, i) => (
                      <text
                        key={i}
                        x={tx.x}
                        y={tx.y}
                        textAnchor={tx.anchor}
                        fontSize={tx.strong ? 12 : LABEL_FS}
                        fontWeight={tx.strong ? 600 : undefined}
                        className={tx.strong ? undefined : "tnum"}
                        style={{ fill: tx.strong ? "var(--ink)" : "var(--ink-2)" }}
                        paintOrder="stroke"
                        stroke="var(--paper-sunk)"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {tx.text}
                      </text>
                    ))}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
      {interactive && box && (
        <>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...btn, opacity: v.k >= MAX_K ? 0.5 : 1 }}
              disabled={v.k >= MAX_K}
              onClick={() => zoomBy(1.25)}
            >
              {t("settle.graph.zoomIn")}
            </button>
            <button
              type="button"
              style={{ ...btn, opacity: v.k <= MIN_K ? 0.5 : 1 }}
              disabled={v.k <= MIN_K}
              onClick={() => zoomBy(0.8)}
            >
              {t("settle.graph.zoomOut")}
            </button>
            <button
              type="button"
              style={{ ...btn, opacity: v.k === 1 && Object.keys(overrides).length === 0 ? 0.5 : 1 }}
              disabled={v.k === 1 && Object.keys(overrides).length === 0}
              onClick={resetAll}
            >
              {t("settle.graph.resetView")}
            </button>
          </div>
          <p className="mt-2 text-center text-[13px]" style={{ color: "var(--ink-2)" }}>
            {t("settle.graph.help")}
          </p>
          {layout && layout.hidden > 0 && (
            <p className="mt-1 text-center text-[13px]" style={{ color: "var(--ink-2)" }}>
              {t("settle.graph.hiddenLabels")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

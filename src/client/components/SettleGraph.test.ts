// Pure geometry for the settle graph. Amounts elsewhere are paise; none here.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  clampView,
  curveControl,
  graphBox,
  labelAnchor,
  labelBox,
  layoutNodes,
  placeEdgeLabels,
  pointOnCurve,
  rectsOverlap,
  trimCurve,
  zoomAt,
  type LabelIn,
} from "./SettleGraph";

describe("layoutNodes", () => {
  it("places one node per id", () => {
    expect(Object.keys(layoutNodes(["a", "b", "c", "d"], 360, 360))).toHaveLength(4);
  });

  it("puts the first node at the top, then clockwise", () => {
    const at = layoutNodes(["a", "b", "c", "d"], 360, 360);
    expect(at.a?.x).toBeCloseTo(180);
    expect(at.a?.y).toBeLessThan(180);
    // Clockwise on screen (y down): the second node is to the right of the top one.
    expect(at.b?.x).toBeGreaterThan(180);
    expect(at.b?.y).toBeCloseTo(180);
  });

  it("centres a single node", () => {
    expect(layoutNodes(["solo"], 360, 360)).toEqual({ solo: { x: 180, y: 180 } });
  });

  it("keeps every node inside a wide box", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
    for (const { x, y } of Object.values(layoutNodes(ids, 640, 480, 180, 170))) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(640);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(480);
    }
  });
});

describe("labelAnchor", () => {
  it("puts a top node's labels above, centred", () => {
    expect(labelAnchor(-Math.PI / 2)).toEqual({ anchor: "middle", place: "above" });
  });

  it("puts a right node's labels beside it, starting outward", () => {
    expect(labelAnchor(0)).toEqual({ anchor: "start", place: "beside" });
  });

  it("puts a bottom node's labels below, centred", () => {
    expect(labelAnchor(Math.PI / 2)).toEqual({ anchor: "middle", place: "below" });
  });

  it("puts a left node's labels beside it, ending outward", () => {
    expect(labelAnchor(Math.PI)).toEqual({ anchor: "end", place: "beside" });
  });
});

describe("view maths", () => {
  it("clamps zoom to 1..4", () => {
    expect(clampView({ k: 0.2, x: 0, y: 0 }, 300, 300).k).toBe(1);
    expect(clampView({ k: 9, x: 0, y: 0 }, 300, 300).k).toBe(4);
  });

  it("stops the pan at the content edges", () => {
    expect(clampView({ k: 2, x: 50, y: -900 }, 300, 200)).toEqual({ k: 2, x: 0, y: -200 });
  });

  it("has no pan room when zoomed out", () => {
    expect(clampView({ k: 1, x: -30, y: 30 }, 300, 300)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it("zooming about a point keeps that point fixed", () => {
    const pt = { x: 100, y: 50 };
    const z = zoomAt(DEFAULT_VIEW, pt, 3, 300, 300);
    expect(z.k).toBe(3);
    // The content point under the cursor before the zoom is still under it after.
    expect(z.x + 100 * z.k).toBeCloseTo(100);
    expect(z.y + 50 * z.k).toBeCloseTo(50);
  });

  it("reset is the identity view", () => {
    expect(DEFAULT_VIEW).toEqual({ k: 1, x: 0, y: 0 });
    expect(clampView(DEFAULT_VIEW, 300, 300)).toEqual(DEFAULT_VIEW);
  });
});

describe("graphBox", () => {
  it("is taller than wide on a narrow container", () => {
    const b = graphBox(300, 4);
    expect(b.h).toBeGreaterThan(b.w);
    expect(b.nameMax).toBe(9);
  });

  it("is square on a medium container", () => {
    expect(graphBox(500, 4)).toMatchObject({ w: 500, h: 500, nameMax: 12 });
  });

  it("is wider than tall on a wide container", () => {
    const b = graphBox(640, 4);
    expect(b.h).toBe(480);
    expect(b.nameMax).toBe(16);
  });

  it("shrinks nodes for a crowded narrow graph", () => {
    expect(graphBox(300, 7).nodeR).toBeLessThan(graphBox(300, 4).nodeR);
  });
});

describe("curved edges", () => {
  it("the curve starts and ends at its endpoints", () => {
    const p = { x: 0, y: 0 };
    const q = { x: 100, y: 0 };
    const c = curveControl(p, q);
    expect(pointOnCurve(p, c, q, 0)).toEqual(p);
    expect(pointOnCurve(p, c, q, 1)).toEqual(q);
  });

  it("bows the control point to one side, and the reverse edge to the other", () => {
    const p = { x: 0, y: 0 };
    const q = { x: 100, y: 0 };
    const fwd = curveControl(p, q);
    const back = curveControl(q, p);
    expect(fwd.y).not.toBeCloseTo(0);
    expect(Math.sign(fwd.y)).toBe(-Math.sign(back.y));
    expect(Math.abs(fwd.y)).toBeCloseTo(15); // 15% of a 100-unit edge
  });

  it("trims the curve so its ends sit on the node circles", () => {
    const p = { x: 0, y: 0 };
    const q = { x: 100, y: 0 };
    const c = curveControl(p, q);
    const { start, end } = trimCurve(p, c, q, 10);
    expect(Math.hypot(start.x - p.x, start.y - p.y)).toBeCloseTo(10, 0);
    expect(Math.hypot(end.x - q.x, end.y - q.y)).toBeCloseTo(10, 0);
  });
});

describe("placeEdgeLabels", () => {
  const edge = (
    key: string,
    amount: number,
    p: { x: number; y: number },
    q: { x: number; y: number },
    forced = false,
  ): LabelIn => {
    const c = curveControl(p, q);
    return { key, amount, text: `₹${amount}.00 to pay`, p, c, q, forced };
  };

  it("shows a single edge at t = 0.5, offset 10 units from the curve", () => {
    const p = { x: 40, y: 150 };
    const q = { x: 300, y: 150 };
    const res = placeEdgeLabels([edge("a", 100, p, q)], { rects: [], circles: [] }, { w: 340, h: 300 });
    const mid = pointOnCurve(p, curveControl(p, q), q, 0.5);
    expect(res.a).not.toBeNull();
    expect(Math.hypot((res.a?.x ?? 0) - mid.x, (res.a?.y ?? 0) - mid.y)).toBeCloseTo(10, 0);
  });

  it("gives two crossing edges labels that do not overlap", () => {
    const items = [
      edge("a", 500, { x: 20, y: 20 }, { x: 320, y: 280 }),
      edge("b", 400, { x: 320, y: 20 }, { x: 20, y: 280 }),
    ];
    const res = placeEdgeLabels(items, { rects: [], circles: [] }, { w: 340, h: 300 });
    const boxes = items.map((it) => {
      const pt = res[it.key];
      expect(pt).not.toBeNull();
      return labelBox(it.text, pt?.x ?? 0, (pt?.y ?? 0) + 0.35 * 11, 11, "middle");
    });
    expect(rectsOverlap(boxes[0] as never, boxes[1] as never)).toBe(false);
  });

  it("never places a label on a node", () => {
    const node = { x: 170, y: 150, r: 20 };
    const items = [edge("a", 100, { x: 60, y: 150 }, { x: 280, y: 150 })];
    const res = placeEdgeLabels(items, { rects: [], circles: [node] }, { w: 340, h: 300 });
    // The node blocks every candidate here, so the label is hidden rather than drawn on it.
    const pt = res.a;
    expect(pt).toBeNull();
    const shown = placeEdgeLabels(items, { rects: [], circles: [{ x: 170, y: 150, r: 5 }] }, { w: 340, h: 300 }).a;
    expect(shown).not.toBeNull();
    const r = labelBox("₹100.00 to pay", shown?.x ?? 0, (shown?.y ?? 0) + 0.35 * 11, 11, "middle");
    const nx = Math.min(Math.max(node.x, r.x0), r.x1);
    const ny = Math.min(Math.max(node.y, r.y0), r.y1);
    expect(Math.hypot(node.x - nx, node.y - ny)).toBeGreaterThanOrEqual(5);
  });

  it("keeps every shown label clear when 8 members have all 28 edges in a phone box", () => {
    const n = 8;
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const at = layoutNodes(ids, 320, 368, 110, 140);
    const items: LabelIn[] = [];
    let amount = 1000;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = at[ids[i] as string] as { x: number; y: number };
        const q = at[ids[j] as string] as { x: number; y: number };
        items.push(edge(`${i}-${j}`, amount--, p, q));
      }
    }
    const circles = ids.map((id) => ({ ...(at[id] as { x: number; y: number }), r: 14 }));
    const res = placeEdgeLabels(items, { rects: [], circles }, { w: 320, h: 368 });
    const shown = items.filter((it) => res[it.key] !== null);
    expect(shown.length).toBeLessThan(items.length);
    const boxes = shown.map((it) => {
      const pt = res[it.key] as { x: number; y: number };
      return labelBox(it.text, pt.x, pt.y + 0.35 * 11, 11, "middle");
    });
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        expect(rectsOverlap(boxes[a] as never, boxes[b] as never)).toBe(false);
      }
    }
  });

  it("always shows a forced (selected) label, even when it cannot fit", () => {
    const blocker = { x: 170, y: 150, r: 300 };
    const items = [edge("a", 100, { x: 60, y: 150 }, { x: 280, y: 150 }, true)];
    const res = placeEdgeLabels(items, { rects: [], circles: [blocker] }, { w: 340, h: 300 });
    expect(res.a).not.toBeNull();
  });
});

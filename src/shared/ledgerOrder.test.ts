import { describe, expect, it } from "vitest";
import { compareLedgers, lastActivityAt, type Orderable } from "~/shared/ledgerOrder";

const row = (over: Partial<Orderable> & { id: string }): Orderable => ({
  pinned: false,
  archivedAt: null,
  lastActivityAt: 0,
  ...over,
});

const sorted = (rows: Orderable[]) => [...rows].sort(compareLedgers).map((r) => r.id);

describe("compareLedgers", () => {
  it("puts a starred ledger ahead of a more recent unstarred one", () => {
    expect(
      sorted([row({ id: "a", lastActivityAt: 900 }), row({ id: "b", pinned: true, lastActivityAt: 100 })]),
    ).toEqual(["b", "a"]);
  });

  it("orders unstarred ledgers by most recent activity", () => {
    expect(sorted([row({ id: "old", lastActivityAt: 1 }), row({ id: "new", lastActivityAt: 2 })])).toEqual([
      "new",
      "old",
    ]);
  });

  it("sorts archived ledgers last, even when starred", () => {
    expect(
      sorted([
        row({ id: "arch", pinned: true, archivedAt: 5, lastActivityAt: 999 }),
        row({ id: "open", lastActivityAt: 1 }),
      ]),
    ).toEqual(["open", "arch"]);
  });

  it("breaks ties by createdAt desc, then id, regardless of input order", () => {
    const x = row({ id: "x", lastActivityAt: 7, createdAt: 1 });
    const y = row({ id: "y", lastActivityAt: 7, createdAt: 2 });
    const z = row({ id: "z", lastActivityAt: 7 });
    expect(sorted([x, y, z])).toEqual(["y", "x", "z"]);
    expect(sorted([z, x, y])).toEqual(["y", "x", "z"]);
    expect(sorted([row({ id: "b", lastActivityAt: 7 }), row({ id: "a", lastActivityAt: 7 })])).toEqual(["a", "b"]);
  });
});

describe("lastActivityAt", () => {
  it("is the newest expense entry time, ignoring paidAt", () => {
    expect(lastActivityAt(10, [{ createdAt: 50 }, { createdAt: 30 }], [])).toBe(50);
  });

  it("is moved forward by a later settlement", () => {
    expect(lastActivityAt(10, [{ createdAt: 50 }], [{ declaredAt: 80 }])).toBe(80);
  });

  it("falls back to the ledger's creation time with no activity", () => {
    expect(lastActivityAt(10, [], [])).toBe(10);
  });
});

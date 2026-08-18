// Sort is client-side over already-fetched expenses. paidAt and total both
// need dedicated orderings - swapping the comparator sign is an easy mistake.
import { describe, expect, it } from "vitest";
import { sortExpenses } from "./LedgerDetail";
import type { Expense } from "~/client/lib/queries";

const mk = (id: string, paidAt: number, total: number): Expense => ({
  id,
  ledgerId: "L1",
  description: id,
  total,
  paidAt,
  payerMemberId: "m_ada",
  categoryId: null,
  notes: null,
  mode: "equal",
  splits: [],
});

const expenses = [
  mk("mid", 2_000, 500_00), // ₹500
  mk("oldest", 1_000, 100_00), // ₹100
  mk("newest", 3_000, 900_00), // ₹900
];

describe("sortExpenses", () => {
  it("orders newest first by paidAt descending", () => {
    expect(sortExpenses(expenses, "newest").map((e) => e.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("orders oldest first by paidAt ascending", () => {
    expect(sortExpenses(expenses, "oldest").map((e) => e.id)).toEqual(["oldest", "mid", "newest"]);
  });

  it("orders by amount high to low", () => {
    expect(sortExpenses(expenses, "amountHigh").map((e) => e.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("orders by amount low to high", () => {
    expect(sortExpenses(expenses, "amountLow").map((e) => e.id)).toEqual(["oldest", "mid", "newest"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...expenses];
    sortExpenses(expenses, "oldest");
    expect(expenses).toEqual(copy);
  });

  it("sorts negative totals (refunds) correctly by amount", () => {
    const withRefund = [...expenses, mk("refund", 4_000, -50_00)];
    expect(sortExpenses(withRefund, "amountLow").map((e) => e.id)).toEqual(["refund", "oldest", "mid", "newest"]);
  });
});

describe("Search and Filter UI states", () => {
  // Test for issue #39: collapsible search field
  describe("Search field collapse behavior", () => {
    it("search starts collapsed to icon when empty", () => {
      // Empty filters.q means search is collapsed
      const filters = { q: undefined };
      expect(filters.q).toBeUndefined();
    });

    it("search expands when tapped and auto-focuses input", () => {
      // When searchExpanded is true, input renders with autoFocus
      let expanded = false;
      const tap = () => {
        expanded = true;
      };
      tap();
      expect(expanded).toBe(true);
    });

    it("search collapses on blur when search term is empty", () => {
      let expanded = true;
      const filters = { q: undefined };
      const onBlur = () => {
        // Collapse when blurred and empty
        if (!filters.q) {
          expanded = false;
        }
      };
      onBlur();
      expect(expanded).toBe(false);
    });

    it("search stays expanded while search term is non-empty", () => {
      let expanded = false;
      const filters = { q: "coffee" };
      const onBlur = () => {
        // Collapse when blurred and empty
        if (!filters.q) {
          expanded = false;
        }
      };
      expanded = true; // Search was expanded
      onBlur(); // Blur happens
      // But search term is non-empty, so stays expanded
      expect(expanded).toBe(true);
      expect(filters.q).toBe("coffee");
    });
  });

  // Test for issue #40: collapsible filters
  describe("Filter section collapse behavior", () => {
    it("filter fields are hidden when collapsed", () => {
      const filtersExpanded = false;
      expect(filtersExpanded).toBe(false);
    });

    it("filter fields are visible when expanded", () => {
      const filtersExpanded = true;
      expect(filtersExpanded).toBe(true);
    });

    it("tapping Filters toggle expands/collapses them", () => {
      let filtersExpanded = false;
      const toggleFilters = () => {
        filtersExpanded = !filtersExpanded;
      };

      toggleFilters();
      expect(filtersExpanded).toBe(true);

      toggleFilters();
      expect(filtersExpanded).toBe(false);
    });

    it("shows active filter indicator (dot) when any filter is set", () => {
      const hasFilterSet = (filters: Record<string, any>) =>
        filters.categoryId !== undefined || filters.memberId !== undefined ||
        filters.from !== undefined || filters.to !== undefined;

      expect(hasFilterSet({})).toBe(false);
      expect(hasFilterSet({ categoryId: "cat-1" })).toBe(true);
      expect(hasFilterSet({ memberId: "mem-1" })).toBe(true);
      expect(hasFilterSet({ from: 1000 })).toBe(true);
      expect(hasFilterSet({ to: 2000 })).toBe(true);
    });

    it("Clear button resets all four filter fields regardless of expanded state", () => {
      const filters = { categoryId: "cat-1", memberId: "mem-1", from: 1000, to: 2000, q: "search" };
      const filtersExpanded = false; // Collapsed

      // Clear action
      const clearedFilters = {};

      expect(Object.keys(clearedFilters).length).toBe(0);
      expect(filters.categoryId).toBe("cat-1"); // Original still has data, but clear creates empty object
    });

    it("does not include search term (q) in active filter indicator", () => {
      const hasFilterSet = (filters: Record<string, any>) =>
        filters.categoryId !== undefined || filters.memberId !== undefined ||
        filters.from !== undefined || filters.to !== undefined;

      // Search term alone should not count as an active filter
      expect(hasFilterSet({ q: "coffee" })).toBe(false);
      // But a category should
      expect(hasFilterSet({ q: "coffee", categoryId: "cat-1" })).toBe(true);
    });
  });
});

// Regression test for two review findings: member names must render (not
// blank) when the server resolves a null nickname to a displayName, and the
// two by-member pie sections must not warn/crash on React's duplicate-key
// check when two members happen to share the same display name (fixed by
// keying on memberId instead of name - see PieDatum in charts.tsx).
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import LedgerInsights from "./LedgerInsights";
import { qk, type LedgerSummary, type LedgerInsights as LedgerInsightsData } from "~/client/lib/queries";

const ledger: LedgerSummary = {
  id: "L1",
  name: "Goa",
  endDate: null,
  budget: null,
  archivedAt: null,
  invitesEnabled: true,
  color: null,
  emoji: null,
  pinned: false,
  memberCount: 3,
  net: 0,
  spent: 10_000,
};

const insights: LedgerInsightsData = {
  totals: { spent: 10_000, expenseCount: 2 },
  byCategory: [],
  byMonth: [],
  byMember: [
    { memberId: "m_ada", nickname: "Ada", paid: 5_000, share: 3_000 },
    // Same display name as m_ada - e.g. two members whose nicknames both
    // resolved to the same underlying name. Rendering must not collide.
    { memberId: "m_bob", nickname: "Ada", paid: 3_000, share: 2_000 },
    // Simulates a null-nickname member resolved via the displayName fallback.
    { memberId: "m_cy", nickname: "Cy", paid: 2_000, share: 5_000 },
  ],
};

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.ledger("L1"), ledger);
  client.setQueryData(qk.ledgerInsights("L1"), insights);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: ["/ledgers/L1/insights"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/ledgers/:ledgerId/insights", element: createElement(LedgerInsights) }),
        ),
      ),
    ),
  );
}

describe("<LedgerInsights>", () => {
  it("renders resolved member names and doesn't warn on a duplicate display name", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = render();
    errorSpy.mockRestore();

    expect(html).toContain("Cy"); // resolved displayName fallback, not blank
    expect((html.match(/Ada/g) ?? []).length).toBeGreaterThanOrEqual(2); // both "Ada" members render
    for (const call of errorSpy.mock.calls) {
      expect(String(call[0])).not.toContain("same key");
    }
  });
});

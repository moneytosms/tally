// The category chip row (issue #33) replaced a Select behind "more details"
// and the natural-language quick-add line above it. The chip marked pressed
// must track categoryId, and nothing from the removed NL line may remain in
// the markup or the module graph.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import ExpenseForm from "./ExpenseForm";
import { qk, type Category, type LedgerSummary, type Member, type Me } from "~/client/lib/queries";
import { t } from "~/client/i18n";

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
  memberCount: 2,
  net: 0,
  spent: 0,
};

const me: Me = {
  id: "u_ada",
  displayName: "Ada",
  vpa: null,
  isOwner: false,
  accountType: "full",
  email: null,
  hasPassword: false,
  credentials: [],
};

const members: Member[] = [
  { id: "m_ada", userId: "u_ada", guestName: null, nickname: "Ada", leftAt: null },
  { id: "m_bo", userId: null, guestName: "Bo", nickname: "Bo", leftAt: null },
];

const categories: Category[] = [
  { id: "c_food", name: "Food", icon: "🍔", isDefault: true },
  { id: "c_travel", name: "Travel", icon: "🚗", isDefault: true },
];

/** Renders with the query cache pre-filled - renderToStaticMarkup never runs
 *  effects, so no query ever actually fetches; the cached snapshot is all the
 *  render sees. */
function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.ledgers, [ledger]);
  client.setQueryData(qk.me, me);
  client.setQueryData(qk.members("L1"), members);
  client.setQueryData(qk.categories, categories);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: ["/ledgers/L1/expenses/new"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/ledgers/:ledgerId/expenses/new",
            element: createElement(ExpenseForm, { onDone: () => {} }),
          }),
        ),
      ),
    ),
  );
}

function renderEdit(mode: "exact" | "percent", splits: Array<{ memberId: string; amount: number; inputValue: number | null }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.ledgers, [ledger]);
  client.setQueryData(qk.me, me);
  client.setQueryData(qk.members("L1"), members);
  client.setQueryData(qk.categories, categories);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: ["/ledgers/L1/expenses/e1/edit"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/ledgers/:ledgerId/expenses/:id/edit",
            element: createElement(ExpenseForm, {
              onDone: () => {},
              expense: {
                id: "e1",
                ledgerId: "L1",
                description: "Lunch",
                total: 40000, // ₹400.00
                paidAt: Date.UTC(2026, 0, 1),
                payerMemberId: "m_ada",
                categoryId: "c_food",
                notes: null,
                mode,
                splits,
              },
            }),
          }),
        ),
      ),
    ),
  );
}

describe("<ExpenseForm> remaining-to-allocate indicator", () => {
  it("shows the remaining amount while an exact split is under-allocated", () => {
    const html = renderEdit("exact", [
      { memberId: "m_ada", amount: 20000, inputValue: 100_00 }, // ₹100.00 entered
      { memberId: "m_bo", amount: 20000, inputValue: null }, // nothing entered yet
    ]);
    expect(html).toContain(t("expense.remainingToAllocate", { amount: "₹300.00" }));
    expect(html).not.toContain(t("expense.overAllocated", { amount: "₹300.00" }));
  });

  it("flags over-allocation distinctly from under-allocation", () => {
    const html = renderEdit("exact", [
      { memberId: "m_ada", amount: 20000, inputValue: 300_00 },
      { memberId: "m_bo", amount: 20000, inputValue: 200_00 },
    ]);
    expect(html).toContain(t("expense.overAllocated", { amount: "₹100.00" }));
  });

  it("hides the indicator once an exact split exactly matches the total", () => {
    const html = renderEdit("exact", [
      { memberId: "m_ada", amount: 20000, inputValue: 200_00 },
      { memberId: "m_bo", amount: 20000, inputValue: 200_00 },
    ]);
    expect(html).not.toContain(t("expense.remainingToAllocate", { amount: "₹0.00" }));
    expect(html).not.toContain('role="status"');
  });

  it("gives percent mode the same remaining-percent treatment", () => {
    const html = renderEdit("percent", [
      { memberId: "m_ada", amount: 20000, inputValue: 30 },
      { memberId: "m_bo", amount: 20000, inputValue: 30 },
    ]);
    expect(html).toContain(t("expense.remainingToAllocate", { amount: "40%" }));
  });
});

describe("<ExpenseForm> category chips", () => {
  it("renders a chip per category plus the uncategorised chip, pressed by default", () => {
    const html = renderForm();
    expect(html).toContain(t("expense.categoryNone"));
    expect(html).toContain("Food");
    expect(html).toContain("Travel");
    // No category picked yet: the "none" chip is the one marked pressed.
    const noneChip = html.slice(html.indexOf(t("expense.categoryNone")) - 400, html.indexOf(t("expense.categoryNone")));
    expect(noneChip).toContain('aria-pressed="true"');
  });

  it("marks a category's own chip pressed when the expense already has one", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.ledgers, [ledger]);
    client.setQueryData(qk.me, me);
    client.setQueryData(qk.members("L1"), members);
    client.setQueryData(qk.categories, categories);

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/ledgers/L1/expenses/e1/edit"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/ledgers/:ledgerId/expenses/:id/edit",
              element: createElement(ExpenseForm, {
                onDone: () => {},
                expense: {
                  id: "e1",
                  ledgerId: "L1",
                  description: "Lunch",
                  total: 40000, // ₹400.00
                  paidAt: Date.UTC(2026, 0, 1),
                  payerMemberId: "m_ada",
                  categoryId: "c_food",
                  notes: null,
                  mode: "equal",
                  splits: [
                    { memberId: "m_ada", amount: 20000, inputValue: null }, // ₹200.00
                    { memberId: "m_bo", amount: 20000, inputValue: null }, // ₹200.00
                  ],
                },
              }),
            }),
          ),
        ),
      ),
    );

    const foodChip = html.slice(html.indexOf("Food") - 400, html.indexOf("Food"));
    expect(foodChip).toContain('aria-pressed="true"');
  });

  it("leaves no trace of the removed natural-language quick-add line", () => {
    const html = renderForm();
    expect(html).not.toContain(t("expense.naturalLanguage"));
    expect(html).not.toContain(t("nl.exampleBare"));
  });
});

// ADR 0008: a restricted account (joined via a ledger invite) has no
// self-service way to create a ledger. LedgersTab's empty state is the one
// place that offer is unconditionally in the markup (no click needed to
// reveal it), so it's the cheapest place to assert it is gone.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { LedgersTab } from "./LedgersTab";
import { qk, type Me } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const baseMe: Me = {
  id: "u_ada",
  displayName: "Ada",
  vpa: null,
  isOwner: false,
  accountType: "full",
  email: null,
  hasPassword: false,
  credentials: [],
};

function renderTab(me: Me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.ledgers, []);
  client.setQueryData(qk.me, me);
  client.setQueryData(qk.recentActivity, []);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(LedgersTab)),
    ),
  );
}

describe("<LedgersTab> ledger-creation affordance", () => {
  it("offers to create a ledger for a full account", () => {
    const html = renderTab(baseMe);
    expect(html).toContain(t("add.trip"));
    expect(html).toContain(t("add.group"));
    expect(html).toContain(t("add.pair"));
  });

  it("hides ledger creation for a restricted account", () => {
    const html = renderTab({ ...baseMe, accountType: "restricted" });
    expect(html).not.toContain(t("add.trip"));
    expect(html).not.toContain(t("add.group"));
    expect(html).not.toContain(t("add.pair"));
  });
});

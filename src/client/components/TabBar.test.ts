import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { TabBar } from "./TabBar";

// The tab whose link carries aria-current, by its visible label.
const activeTab = (path: string) => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(TabBar)));
  const anchor = html.split("<a ").find((a) => a.includes('aria-current="page"'));
  return anchor?.match(/>(?:<span[^>]*>[^<]*<\/span>)?<span>([^<]+)</)?.[1] ?? null;
};

describe("<TabBar>", () => {
  it("keeps Ledgers active on the root and on any ledger screen", () => {
    expect(activeTab("/")).toBe("Ledgers");
    expect(activeTab("/ledgers/abc")).toBe("Ledgers");
    expect(activeTab("/ledgers/abc/settle")).toBe("Ledgers");
  });

  it("keeps You active on admin", () => {
    expect(activeTab("/you")).toBe("You");
    expect(activeTab("/you/admin")).toBe("You");
  });

  it("highlights exactly one tab on a plain tab route", () => {
    expect(activeTab("/balances")).toBe("Balances");
  });
});

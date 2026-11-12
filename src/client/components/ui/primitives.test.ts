// Logic and markup checks for the new primitives. Static markup only (no DOM in this
// suite), so click behaviour is checked by walking the element tree and calling onClick.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./IconButton";
import { LedgerMark, ledgerColorVar } from "./LedgerMark";
import { SearchField } from "./SearchField";
import { Segmented } from "./Segmented";
import { LEDGER_COLOR_VALUES } from "~/shared/schemas";

type Node = ReactElement<{ children?: unknown; onClick?: () => void }> | null | undefined;

// Every button in a rendered element tree, in document order.
function buttons(node: unknown, out: ReactElement<{ onClick?: () => void }>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => buttons(n, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as Node & object;
    if (el?.type === "button") out.push(el as ReactElement<{ onClick?: () => void }>);
    buttons((el as ReactElement<{ children?: unknown }>).props.children, out);
  }
  return out;
}

describe("<Segmented>", () => {
  const options = [
    { value: "equal", label: "Equal" },
    { value: "exact", label: "Exact" },
  ] as const;

  it("marks only the active segment aria-pressed and names the group", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented, { label: "Split", options: [...options], value: "equal", onChange: () => {} }),
    );
    expect(html).toContain('aria-label="Split"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Equal</);
  });

  it("calls onChange with the chosen value", () => {
    const onChange = vi.fn();
    const tree = Segmented({ label: "Split", options: [...options], value: "equal", onChange });
    buttons(tree)[1]?.props.onClick?.();
    expect(onChange).toHaveBeenCalledWith("exact");
  });
});

describe("<IconButton>", () => {
  it("renders its required label as aria-label", () => {
    const html = renderToStaticMarkup(createElement(IconButton, { icon: "filter", label: "Filter and sort" }));
    expect(html).toContain('aria-label="Filter and sort"');
    expect(html).not.toContain("aria-pressed");
  });

  it("sets aria-pressed and folds the badge count into the label", () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { icon: "filter", label: "Filter and sort", pressed: true, badge: 2 }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Filter and sort, 2 active"');
  });
});

describe("<LedgerMark>", () => {
  it("shows the emoji when there is one", () => {
    const html = renderToStaticMarkup(createElement(LedgerMark, { color: "sky", emoji: "✈️", name: "Goa trip" }));
    expect(html).toContain("✈️");
    expect(html).toContain('aria-hidden="true"');
  });

  it("falls back to the first letter of the name", () => {
    const html = renderToStaticMarkup(createElement(LedgerMark, { color: null, name: "flat" }));
    expect(html).toContain(">F<");
  });

  it("maps every stored colour to its tokens", () => {
    for (const value of LEDGER_COLOR_VALUES) {
      expect(ledgerColorVar(value)?.solid).toBe(`var(--ledger-${value})`);
      expect(ledgerColorVar(value)?.wash).toBe(`var(--ledger-${value}-wash)`);
    }
    expect(ledgerColorVar(null)).toBeUndefined();
  });
});

describe("<SearchField>", () => {
  const render = (value: string) =>
    renderToStaticMarkup(createElement(SearchField, { value, onChange: () => {}, label: "Search expenses" }));

  it("shows a clear button only when there is text", () => {
    expect(render("")).not.toContain("Clear search");
    expect(render("lunch")).toContain('aria-label="Clear search"');
  });

  it("names the input with its visually hidden label", () => {
    expect(render("")).toMatch(/sr-only[^>]*>Search expenses</);
  });
});

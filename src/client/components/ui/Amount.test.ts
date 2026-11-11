// Amount is the single choke point for money on screen. If this test breaks,
// a bare number is one render away.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Amount } from "./Amount";

const render = (paise: number) => renderToStaticMarkup(createElement(Amount, { paise, label: "your position" }));

describe("<Amount>", () => {
  it("renders a sign and a label for a positive amount", () => {
    const html = render(1234); // ₹12.34
    expect(html).toContain("your position");
    expect(html).toContain(">+<");
    expect(html).toContain("₹12.34");
    expect(html).toContain("You are owed"); // visible words, not just the sign
    expect(html).toMatch(/sr-only[^>]*>your position</); // label is still announced, not shown
  });

  it("renders a sign and a label for a negative amount", () => {
    const html = render(-1234); // -₹12.34
    expect(html).toContain("your position");
    expect(html).toContain(">−<");
    expect(html).toContain("₹12.34");
    expect(html).not.toContain("--₹");
    expect(html).toContain("You owe");
  });

  it("renders a sign and a label for zero", () => {
    const html = render(0);
    expect(html).toContain("your position");
    expect(html).toContain(">±<");
    expect(html).toContain("₹0.00");
    expect(html).toContain("Settled");
  });

  it("never renders a number without its label", () => {
    for (const paise of [1234, -1234, 0]) {
      expect(render(paise).indexOf("your position")).toBeLessThan(render(paise).indexOf("₹"));
    }
  });

  // A magnitude is not a balance. Saying "You are owed" over an expense total
  // told every screen-reader user the opposite of the truth on half the app.
  it("speaks no direction for a neutral amount", () => {
    const html = renderToStaticMarkup(
      createElement(Amount, { paise: 45000, label: "total", tone: "neutral" as const }),
    );
    expect(html).toContain("total");
    expect(html).toContain("₹450.00");
    expect(html).not.toContain("You are owed");
    expect(html).not.toContain("You owe");
  });

  it("speaks another member's position about them, not about the viewer", () => {
    const theyAreOwed = renderToStaticMarkup(
      createElement(Amount, { paise: 383334, label: "net position", subject: "Priya" }),
    );
    expect(theyAreOwed).toContain("Priya is owed");
    expect(theyAreOwed).not.toContain("You are owed");

    const theyOwe = renderToStaticMarkup(
      createElement(Amount, { paise: -383334, label: "net position", subject: "Priya" }),
    );
    expect(theyOwe).toContain("Priya owes");
    expect(theyOwe).not.toContain("You owe");
  });
});

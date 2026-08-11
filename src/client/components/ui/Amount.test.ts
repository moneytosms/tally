// Amount is the single choke point for money on screen. If this test breaks,
// a bare number is one render away.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Amount } from "./Amount";

const render = (paise: number) =>
  renderToStaticMarkup(createElement(Amount, { paise, label: "your position" }));

describe("<Amount>", () => {
  it("renders a sign and a label for a positive amount", () => {
    const html = render(1234); // ₹12.34
    expect(html).toContain("your position");
    expect(html).toContain(">+<");
    expect(html).toContain("₹12.34");
    expect(html).toContain("owed to you"); // sign is not the only cue for a screen reader
  });

  it("renders a sign and a label for a negative amount", () => {
    const html = render(-1234); // -₹12.34
    expect(html).toContain("your position");
    expect(html).toContain(">−<");
    expect(html).toContain("₹12.34");
    expect(html).not.toContain("--₹");
    expect(html).toContain("you owe");
  });

  it("renders a sign and a label for zero", () => {
    const html = render(0);
    expect(html).toContain("your position");
    expect(html).toContain(">±<");
    expect(html).toContain("₹0.00");
    expect(html).toContain("settled");
  });

  it("never renders a number without its label", () => {
    for (const paise of [1234, -1234, 0]) {
      expect(render(paise).indexOf("your position")).toBeLessThan(render(paise).indexOf("₹"));
    }
  });
});

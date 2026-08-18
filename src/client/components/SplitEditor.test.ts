// The money INPUT path. resolveSplits is tested in src/shared/money.test.ts;
// what's tested here is everything between a human's keystrokes and it.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitEditor, paiseToRupeeString, preview, remainingToAllocate, rupeesToPaise } from "./SplitEditor";
import { t } from "~/client/i18n";
import type { SplitMode } from "~/shared/money";

const people = [
  { memberId: "a", name: "Asha" },
  { memberId: "b", name: "Bo" },
  { memberId: "c", name: "Cy" },
];

describe("rupeesToPaise", () => {
  it("parses by string surgery, never through a float", () => {
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("0.07")).toBe(7);
    expect(rupeesToPaise("1234.56")).toBe(123456);
    expect(rupeesToPaise("99999.99")).toBe(9999999);
    expect(rupeesToPaise("1,234.56")).toBe(123456);
    expect(rupeesToPaise("32.99")).toBe(3299); // the classic float casualty
    expect(rupeesToPaise("500")).toBe(50000);
    expect(rupeesToPaise(".5")).toBe(50);
    expect(rupeesToPaise("-250.50")).toBe(-25050); // a refund
  });

  it("returns an integer for every accepted input", () => {
    for (const s of ["0.1", "0.07", "1234.56", "99999.99", "1,234.56", "8.03"]) {
      expect(Number.isInteger(rupeesToPaise(s))).toBe(true);
    }
  });

  it("rejects rubbish", () => {
    for (const s of ["", "  ", "abc", "1.2.3", "12.345", "1e3", "₹50", "-", "12-", "0x10"]) {
      expect(rupeesToPaise(s)).toBeNull();
    }
  });

  it("round-trips through paiseToRupeeString", () => {
    for (const p of [10, 7, 123456, 9999999, 100, -25050]) {
      expect(rupeesToPaise(paiseToRupeeString(p))).toBe(p);
    }
  });
});

describe("preview", () => {
  const run = (mode: SplitMode, raw: Record<string, string>, total = 100_00) =>
    preview({ total, mode, payerIndex: 0, participants: people, raw });

  it("sums exactly to the total in all four modes", () => {
    const cases: Array<[SplitMode, Record<string, string>]> = [
      ["equal", {}],
      ["exact", { a: "33.34", b: "33.33", c: "33.33" }],
      ["shares", { a: "1", b: "1", c: "1" }],
      ["percent", { a: "50", b: "25", c: "25" }],
    ];
    for (const [mode, raw] of cases) {
      const r = run(mode, raw);
      expect(r, mode).toHaveProperty("splits");
      const splits = (r as { splits: number[] }).splits;
      expect(splits.reduce((x, y) => x + y, 0), mode).toBe(100_00);
      expect(splits.every(Number.isInteger), mode).toBe(true);
    }
  });

  it("gives the odd paise to the payer, in stable order", () => {
    // ₹100 three ways: 3333 + 3333 + 3334, remainder to participants[1] (the payer).
    const r = preview({ total: 100_00, mode: "equal", payerIndex: 1, participants: people, raw: {} });
    expect(r).toEqual({ splits: [3333, 3334, 3333] });
  });

  it("blocks exact splits that do not sum to the total", () => {
    const r = run("exact", { a: "33.33", b: "33.33", c: "33.33" });
    expect(r).toEqual({ error: t("expense.error.exactSum") });
  });

  it("blocks percents that do not sum to 100", () => {
    const r = run("percent", { a: "50", b: "25", c: "20" });
    expect(r).toEqual({ error: t("expense.error.percentSum") });
  });

  it("treats a blank or unparseable value as an error, never as zero", () => {
    expect(run("exact", { a: "33.34", b: "", c: "33.33" })).toEqual({ error: t("expense.error.numbers") });
    expect(run("shares", { a: "1", b: "two", c: "1" })).toEqual({ error: t("expense.error.numbers") });
  });

  it("splits a refund by the same rules", () => {
    const r = preview({ total: -100_01, mode: "equal", payerIndex: 0, participants: people, raw: {} });
    const splits = (r as { splits: number[] }).splits;
    expect(splits.reduce((x, y) => x + y, 0)).toBe(-100_01);
    expect(splits.every((s) => s < 0)).toBe(true);
  });
});

describe("remainingToAllocate", () => {
  const run = (mode: SplitMode, raw: Record<string, string>, total = 100_00) =>
    remainingToAllocate({ total, mode, payerIndex: 0, participants: people, raw });

  it("has nothing to say about equal splits", () => {
    expect(run("equal", {})).toBeNull();
  });

  it("reports what's left, under exact entries", () => {
    expect(run("exact", { a: "33.34", b: "33.33" })).toEqual({ unit: "paise", amount: 33_33 });
  });

  it("hides once exact entries match exactly", () => {
    expect(run("exact", { a: "33.34", b: "33.33", c: "33.33" })).toBeNull();
  });

  it("signals over-allocation as negative", () => {
    expect(run("exact", { a: "50.00", b: "50.00", c: "50.00" })).toEqual({ unit: "paise", amount: -50_00 });
  });

  it("treats a blank or unparseable exact entry as unentered, not zero-and-ignored", () => {
    expect(run("exact", { a: "33.34", b: "not a number" })).toEqual({ unit: "paise", amount: 66_66 });
  });

  it("reports remaining percent, not paise, for percent mode", () => {
    expect(run("percent", { a: "50", b: "25" })).toEqual({ unit: "percent", amount: 25 });
    expect(run("percent", { a: "50", b: "30", c: "25" })).toEqual({ unit: "percent", amount: -5 });
    expect(run("percent", { a: "50", b: "25", c: "25" })).toBeNull();
  });

  it("shares: matches what save (resolveSplits) would compute once fully entered - always fully allocated", () => {
    const raw = { a: "1", b: "1", c: "2" };
    expect(run("shares", raw)).toBeNull(); // matches: nothing left, same as preview()'s resolved splits
    const resolved = preview({ total: 100_00, mode: "shares", payerIndex: 0, participants: people, raw });
    expect("splits" in resolved && resolved.splits.reduce((a, b) => a + b, 0)).toBe(100_00);
  });

  it("shares: says nothing while entries are still incomplete or invalid", () => {
    expect(run("shares", { a: "1", b: "" })).toBeNull();
    expect(run("shares", { a: "1", b: "two", c: "1" })).toBeNull();
  });
});

const render = (props: Parameters<typeof SplitEditor>[0]) => renderToStaticMarkup(createElement(SplitEditor, props));

const baseProps = {
  total: 100_00,
  mode: "equal" as SplitMode,
  payerIndex: 0,
  participants: people,
  raw: {},
  onModeChange: () => {},
  onRawChange: () => {},
};

describe("<SplitEditor>", () => {
  it("previews every participant's resolved paise", () => {
    const html = render(baseProps);
    expect(html).toContain("₹33.34"); // payer absorbs the remainder
    expect(html).toContain("₹33.33");
  });

  it("renders a negative total unmistakably as a refund", () => {
    const html = render({ ...baseProps, total: -100_00 });
    expect(html).toContain(t("expense.refund"));
    expect(html).toContain(t("expense.refundNote"));
  });

  it("does not call an ordinary expense a refund", () => {
    expect(render(baseProps)).not.toContain(t("expense.refundNote"));
  });

  it("shows the split error inline", () => {
    const html = render({ ...baseProps, mode: "percent", raw: { a: "50", b: "25", c: "20" } });
    expect(html).toContain(t("expense.error.percentSum"));
    expect(html).toContain('role="alert"');
  });

  it("says nothing about splits before an amount is typed", () => {
    expect(render({ ...baseProps, total: 0 })).not.toContain('role="alert"');
  });

  // ₹90.00 over three people divides exactly, so there is one number to say and
  // the per-person list is noise. This is the collapse the add-expense screen
  // leans on - if it ever fires on an UNEVEN split it would be showing a wrong
  // number, which the next test is there to catch.
  it("collapses an evenly-dividing equal split to a single per-head line", () => {
    const html = render({ ...baseProps, total: 90_00 }); // ₹90.00
    expect(html).toContain("₹30.00");
    expect(html).toContain(t("expense.splitEvenly"));
    // No list, so no per-person rows and nothing to explain about remainders.
    expect(html).not.toContain("<ul");
    expect(html).not.toContain(t("expense.remainderNote"));
  });

  it("refuses to collapse when the split does not divide exactly", () => {
    // ₹100.00 over three is 33.34/33.33/33.33 - "₹33.33 each" would be a lie.
    const html = render(baseProps);
    expect(html).not.toContain(t("expense.splitEvenly"));
    expect(html).toContain("<ul");
    expect(html).toContain(t("expense.remainderNote"));
  });

  it("offers nothing to type in equal mode, even when the list is shown", () => {
    expect(render(baseProps)).not.toContain("<input");
    expect(render({ ...baseProps, mode: "exact" })).toContain("<input");
  });
});

// Pure-logic tests for the custom date-range parsing. Component rendering is
// not exercised anywhere in this repo (no jsdom/RTL setup), so the parsing
// that decides what bounds get sent to useInsights is kept as a plain
// function InsightsTab can call, and that function is what's tested.
import { describe, expect, it } from "vitest";
import { parseCustomRange } from "~/client/routes/InsightsTab";

describe("parseCustomRange", () => {
  it("returns local start-of-day/end-of-day bounds, inclusive", () => {
    const bounds = parseCustomRange("2026-01-01", "2026-01-31");
    expect(bounds).not.toBeNull();
    const from = new Date(bounds!.from);
    const to = new Date(bounds!.to);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 0, 1]);
    expect([from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([0, 0, 0]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 0, 31]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds()]).toEqual([23, 59, 59]);
    expect(bounds!.to).toBeGreaterThan(bounds!.from);
  });

  it("is inclusive of a single-day range", () => {
    const bounds = parseCustomRange("2026-03-15", "2026-03-15");
    expect(bounds).not.toBeNull();
    expect(bounds!.to).toBeGreaterThan(bounds!.from); // spans the whole day
  });

  it("returns null when the end date is before the start date", () => {
    expect(parseCustomRange("2026-03-15", "2026-03-10")).toBeNull();
  });

  it("returns null when either input is empty", () => {
    expect(parseCustomRange("", "2026-03-15")).toBeNull();
    expect(parseCustomRange("2026-03-15", "")).toBeNull();
    expect(parseCustomRange("", "")).toBeNull();
  });
});

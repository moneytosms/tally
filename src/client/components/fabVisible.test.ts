import { describe, expect, it } from "vitest";
import { fabVisible } from "./fabVisible";

const live = { hasActive: true, archivedHere: false };

describe("fabVisible", () => {
  it.each([
    ["/", live, true],
    ["/ledgers/abc", live, true],
    ["/ledgers/abc/activity", live, true],
    ["/ledgers/abc/settle", live, false],
    ["/ledgers/abc/settle/report", live, false],
    ["/ledgers/abc/insights", live, false],
    ["/ledgers/abc/recurring", live, false],
    ["/ledgers/abc/expenses/e1", live, false],
    ["/balances", live, false],
    ["/insights", live, false],
    ["/you", live, false],
    ["/you/admin", live, false],
    ["/welcome", live, false],
    ["/", { hasActive: false, archivedHere: false }, false],
    ["/ledgers/abc", { hasActive: true, archivedHere: true }, false],
  ])("%s with %j is %s", (path, ctx, want) => {
    expect(fabVisible(path, ctx)).toBe(want);
  });
});

import { describe, expect, it } from "vitest";
import { formatDate, formatRelative } from "./format";

// Local time, so the calendar-day arithmetic is the same on every machine.
const now = new Date(2026, 10, 12, 15, 0).getTime(); // 12 Nov 2026, 3pm
const daysBefore = (n: number) => new Date(2026, 10, 12 - n, 10, 0).getTime();

describe("formatRelative", () => {
  it("says today for the same calendar day", () => {
    expect(formatRelative(new Date(2026, 10, 12, 8, 0).getTime(), now)).toBe("Today");
  });

  it("says yesterday for the day before", () => {
    expect(formatRelative(daysBefore(1), now)).toBe("Yesterday");
  });

  it("counts whole days up to 30", () => {
    expect(formatRelative(daysBefore(3), now)).toBe("3 days ago");
    expect(formatRelative(daysBefore(30), now)).toBe("30 days ago");
  });

  it("falls back to the date after 30 days", () => {
    expect(formatRelative(daysBefore(31), now)).toBe(formatDate(daysBefore(31)));
  });
});

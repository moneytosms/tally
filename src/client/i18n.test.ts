import { describe, expect, it, vi } from "vitest";
import { t } from "./i18n";

describe("t()", () => {
  it("interpolates variables", () => {
    expect(t("settle.payUpi", { amount: "₹640" })).toBe("Pay ₹640 with UPI");
  });

  it("selects plural form via count", () => {
    expect(t("expense.member", { count: 1 })).toBe("1 member");
    expect(t("expense.member", { count: 4 })).toBe("4 members");
  });

  it("falls back to the key when missing, warning in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("nope.missing")).toBe("nope.missing");
    warn.mockRestore();
  });
});

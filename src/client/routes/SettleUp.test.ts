// Partial settles and the UPI deep link. Both are money paths: the first decides
// what gets recorded, the second decides what a bank app charges.
import { describe, expect, it } from "vitest";
import { settleAmount, upiLink } from "./SettleUp";
import { t } from "~/client/i18n";

describe("settleAmount", () => {
  it("records a partial settle at the amount typed, not the suggestion", () => {
    // ₹500 against a suggested ₹640 - ₹140 must remain.
    expect(settleAmount("500", 640_00)).toEqual({ paise: 500_00 });
    const suggested = 640_00;
    const paid = (settleAmount("500", suggested) as { paise: number }).paise;
    expect(suggested - paid).toBe(140_00);
  });

  it("accepts the full suggestion", () => {
    expect(settleAmount("640.00", 640_00)).toEqual({ paise: 640_00 });
    expect(settleAmount("0.07", 640_00)).toEqual({ paise: 7 });
  });

  it("refuses more than the suggestion, and refuses nothing", () => {
    expect(settleAmount("700", 640_00)).toEqual({ error: t("settle.errorTooMuch") });
    expect(settleAmount("0", 640_00)).toEqual({ error: t("settle.errorAmount") });
    expect(settleAmount("-50", 640_00)).toEqual({ error: t("settle.errorAmount") });
    expect(settleAmount("abc", 640_00)).toEqual({ error: t("settle.errorAmount") });
    expect(settleAmount("", 640_00)).toEqual({ error: t("settle.errorAmount") });
  });
});

describe("upiLink", () => {
  it("builds the amount from integer paise, to two decimals", () => {
    expect(upiLink({ vpa: "rahul@okhdfc", name: "Rahul", paise: 640_00, note: "tally" })).toBe(
      "upi://pay?pa=rahul%40okhdfc&pn=Rahul&am=640.00&cu=INR&tn=tally",
    );
    expect(upiLink({ vpa: "asha@ybl", name: "Asha K", paise: 7 })).toBe(
      "upi://pay?pa=asha%40ybl&pn=Asha%20K&am=0.07&cu=INR",
    );
    expect(upiLink({ vpa: "a@b", name: "A", paise: 1234_56 })).toContain("am=1234.56");
    expect(upiLink({ vpa: "a@b", name: "A", paise: 3299 })).toContain("am=32.99");
  });
});

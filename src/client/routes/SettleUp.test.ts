// Partial settles and the UPI deep link. Both are money paths: the first decides
// what gets recorded, the second decides what a bank app charges.
import { describe, expect, it } from "vitest";
import {
  activeTransfer,
  effectiveMethod,
  netSum,
  settleAmount,
  sortPositions,
  sortTransfers,
  upiLink,
} from "./SettleUp";
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

describe("netSum", () => {
  it("is zero for a balanced ledger", () => {
    // Asha is owed ₹200.00; Ravi and Meera owe ₹150.00 and ₹50.00 between them.
    const positions = [{ net: 200_00 }, { net: -150_00 }, { net: -50_00 }];
    expect(netSum(positions)).toBe(0);
  });

  it("detects a ledger that does not add up", () => {
    const positions = [{ net: 200_00 }, { net: -150_00 }];
    expect(netSum(positions)).toBe(50_00);
  });
});

describe("sortPositions", () => {
  it("puts the viewer first, then everyone else by name", () => {
    const rows = [
      { memberId: "m_ravi", name: "Ravi" },
      { memberId: "m_asha", name: "Asha" },
      { memberId: "m_meera", name: "Meera" },
    ];
    expect(sortPositions(rows, "m_meera").map((r) => r.memberId)).toEqual(["m_meera", "m_asha", "m_ravi"]);
  });
});

describe("activeTransfer", () => {
  const transfers = [
    { fromMemberId: "m_ravi", toMemberId: "m_asha", amount: 640_00 },
    { fromMemberId: "m_meera", toMemberId: "m_asha", amount: 50_00 },
  ];

  it("finds the open transfer by its pair, with the current amount", () => {
    // Ravi owes Asha ₹640.00 now; the sheet must quote this, not a snapshot.
    expect(activeTransfer(transfers, { fromMemberId: "m_ravi", toMemberId: "m_asha" })?.amount).toBe(640_00);
  });

  it("is null once that debt is gone, so the sheet closes", () => {
    const after = transfers.filter((tr) => tr.fromMemberId !== "m_ravi");
    expect(activeTransfer(after, { fromMemberId: "m_ravi", toMemberId: "m_asha" })).toBeNull();
  });

  it("is null when nothing is open", () => {
    expect(activeTransfer(transfers, null)).toBeNull();
  });
});

describe("effectiveMethod", () => {
  it("falls back to manual when the payee has no VPA", () => {
    expect(effectiveMethod("upi", false)).toBe("manual");
    expect(effectiveMethod("upi", true)).toBe("upi");
    expect(effectiveMethod("forgiven", false)).toBe("forgiven");
    expect(effectiveMethod("manual", true)).toBe("manual");
  });
});

describe("sortTransfers", () => {
  it("lists the viewer's own payments first and keeps the rest in server order", () => {
    const rows = [
      { fromMemberId: "m_ravi", toMemberId: "m_asha" },
      { fromMemberId: "m_meera", toMemberId: "m_asha" },
      { fromMemberId: "m_asha", toMemberId: "m_ravi" },
    ];
    expect(sortTransfers(rows, "m_meera").map((r) => r.fromMemberId)).toEqual(["m_meera", "m_ravi", "m_asha"]);
  });
});

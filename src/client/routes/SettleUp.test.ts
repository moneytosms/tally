// Partial settles and the UPI deep link. Both are money paths: the first decides
// what gets recorded, the second decides what a bank app charges.
import { describe, expect, it } from "vitest";
import {
  activeTransfer,
  effectiveMethod,
  memberLine,
  netSum,
  reroutedReason,
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

describe("reroutedReason", () => {
  it("is empty for a transfer that is itself a direct debt", () => {
    // A owes C ₹500.00 directly; nothing else touches A or C.
    const pairs = [{ fromMemberId: "A", toMemberId: "C", amount: 500_00 }];
    expect(reroutedReason({ fromMemberId: "A", toMemberId: "C" }, pairs)).toEqual({ payerOwes: [], payeeOwed: [] });
  });

  it("lists the payer's debts and the payee's credits when routed through B", () => {
    // A owes B ₹500.00 and B owes C ₹500.00; the plan lets A pay C ₹500.00 directly.
    const pairs = [
      { fromMemberId: "A", toMemberId: "B", amount: 500_00 },
      { fromMemberId: "B", toMemberId: "C", amount: 500_00 },
    ];
    expect(reroutedReason({ fromMemberId: "A", toMemberId: "C" }, pairs)).toEqual({
      payerOwes: [pairs[0]],
      payeeOwed: [pairs[1]],
    });
  });
});

describe("memberLine", () => {
  it("says what is owed to a member who is in credit", () => {
    // Asha paid ₹1,200.00 and her share is ₹700.00, so she is owed ₹500.00.
    const line = memberLine({ name: "Asha", paid: 1200_00, share: 700_00, settledOut: 0, settledIn: 0, net: 500_00 });
    expect(line).toBe("Asha paid ₹1,200.00, share of expenses ₹700.00, so Asha is owed ₹500.00.");
  });

  it("says what is owed by a member in debt, including settlements sent", () => {
    // Ravi paid ₹200.00, share ₹650.00, sent ₹100.00 back; still owes ₹450.00.
    const line = memberLine({
      name: "Ravi",
      paid: 200_00,
      share: 650_00,
      settledOut: 100_00,
      settledIn: 0,
      net: -450_00,
    });
    expect(line).toBe("Ravi paid ₹200.00, share of expenses ₹650.00, settlements sent ₹100.00, so Ravi owes ₹450.00.");
  });

  it("says a settled member is settled, with no sign", () => {
    // Meera paid ₹300.00 and her share is ₹300.00: net ₹0.00.
    const line = memberLine({ name: "Meera", paid: 300_00, share: 300_00, settledOut: 0, settledIn: 50_00, net: 0 });
    expect(line).toBe(
      "Meera paid ₹300.00, share of expenses ₹300.00, settlements received ₹50.00, so Meera is settled.",
    );
  });
});

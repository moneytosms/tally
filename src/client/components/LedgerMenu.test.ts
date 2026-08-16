// The edit form's two nullable fields are the whole risk here: an empty box
// means "clear it", which must reach the server as null, and an untouched box
// must not reach it at all. And a budget is paise - never a float.
import { describe, expect, it } from "vitest";
import { ledgerPatch } from "./LedgerMenu";

const endOfDay = (yyyymmdd: string) => new Date(`${yyyymmdd}T23:59:59`).getTime();

const ledger = {
  name: "Goa",
  endDate: endOfDay("2026-09-05"),
  budget: 250000, // ₹2,500.00
};

const edit = { name: "Goa", endDate: "2026-09-05", budget: "2500.00" };

describe("ledgerPatch", () => {
  it("sends nothing when nothing changed", () => {
    const result = ledgerPatch(ledger, edit);
    expect(result).toEqual({ ok: true, patch: {} });
  });

  it("sends only the field that changed", () => {
    const result = ledgerPatch(ledger, { ...edit, name: "  Goa, December  " });
    expect(result).toEqual({ ok: true, patch: { name: "Goa, December" } });
  });

  it("clears an emptied end date and budget with null, not by omission", () => {
    const result = ledgerPatch(ledger, { ...edit, endDate: "", budget: "" });
    expect(result).toEqual({ ok: true, patch: { endDate: null, budget: null } });
  });

  it("keeps the budget in integer paise", () => {
    const result = ledgerPatch(ledger, { ...edit, budget: "32.99" });
    expect(result).toEqual({ ok: true, patch: { budget: 3299 } }); // ₹32.99
  });

  it("refuses an unparseable or non-positive budget rather than sending a guess", () => {
    expect(ledgerPatch(ledger, { ...edit, budget: "lots" })).toEqual({ ok: false, error: "ledger.budgetInvalid" });
    expect(ledgerPatch(ledger, { ...edit, budget: "0" })).toEqual({ ok: false, error: "ledger.budgetInvalid" });
    expect(ledgerPatch(ledger, { ...edit, budget: "-10" })).toEqual({ ok: false, error: "ledger.budgetInvalid" });
  });

  it("refuses an empty name", () => {
    expect(ledgerPatch(ledger, { ...edit, name: "   " })).toEqual({ ok: false, error: "ledger.nameRequired" });
  });

  it("treats a date as the END of the local day, so the last day is included", () => {
    const result = ledgerPatch({ ...ledger, endDate: null }, { ...edit, endDate: "2026-09-05" });
    expect(result).toEqual({ ok: true, patch: { endDate: endOfDay("2026-09-05") } });
    expect(new Date(endOfDay("2026-09-05")).getDate()).toBe(5);
  });
});

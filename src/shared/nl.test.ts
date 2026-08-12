import { describe, expect, it } from "vitest";
import { parseExpenseLine, type NlMember } from "./nl";
import { MAX_PAISE } from "./money";

const rahul: NlMember = { id: "m-rahul", name: "Rahul" };
const priya: NlMember = { id: "m-priya", name: "Priya" };
const members: NlMember[] = [rahul, priya];

describe("parseExpenseLine - amount formats", () => {
  it("plain integer", () => {
    expect(parseExpenseLine("450", members).total).toBe(45000); // ₹450
  });

  it("two decimals", () => {
    expect(parseExpenseLine("450.50", members).total).toBe(45050); // ₹450.50
  });

  it("rupee symbol", () => {
    expect(parseExpenseLine("₹450", members).total).toBe(45000); // ₹450
  });

  it("Rs prefix", () => {
    expect(parseExpenseLine("Rs 450", members).total).toBe(45000); // ₹450
  });

  it("rs. prefix, no space", () => {
    expect(parseExpenseLine("rs.450", members).total).toBe(45000); // ₹450
  });

  it("thousands comma separator", () => {
    expect(parseExpenseLine("1,250", members).total).toBe(125000); // ₹1,250
  });

  it("1.2k shorthand", () => {
    expect(parseExpenseLine("1.2k", members).total).toBe(120000); // ₹1,200
  });

  it("2k shorthand", () => {
    expect(parseExpenseLine("2k", members).total).toBe(200000); // ₹2,000
  });

  it("450.5 means 45050 paise, not 45005", () => {
    expect(parseExpenseLine("450.5", members).total).toBe(45050); // ₹450.50
  });

  it("450.55", () => {
    expect(parseExpenseLine("450.55", members).total).toBe(45055); // ₹450.55
  });

  it("450.555 (3 decimals) is rejected, not rounded", () => {
    expect(parseExpenseLine("450.555", members).total).toBeNull();
  });

  it("the float trap: 1234.56 is exactly 123456 paise", () => {
    // parseFloat("1234.56") * 100 === 123455.99999999999 in JS - must not use it.
    expect(parseExpenseLine("1234.56", members).total).toBe(123456); // ₹1234.56
  });

  it("amount above MAX_PAISE yields total: null", () => {
    const tooBig = String(MAX_PAISE + 1); // rupees, so paise value is far beyond MAX_PAISE
    expect(parseExpenseLine(tooBig, members).total).toBeNull();
  });
});

describe("parseExpenseLine - description, participants, payer", () => {
  it("extracts description and both participants in input order", () => {
    const r = parseExpenseLine("450 dinner with rahul and priya", members);
    expect(r.total).toBe(45000); // ₹450
    expect(r.description).toBe("dinner");
    expect(r.participantIds).toEqual([rahul.id, priya.id]);
  });

  it("participants keep input order even when reversed", () => {
    const r = parseExpenseLine("450 dinner with priya and rahul", members);
    expect(r.participantIds).toEqual([priya.id, rahul.id]);
  });

  it("paid by <name> sets payerId", () => {
    const r = parseExpenseLine("1200 cab paid by rahul", members);
    expect(r.total).toBe(120000); // ₹1200
    expect(r.payerId).toBe(rahul.id);
  });

  it("<name> paid sets payerId", () => {
    const r = parseExpenseLine("1200 cab rahul paid", members);
    expect(r.payerId).toBe(rahul.id);
  });

  it("no payer phrase leaves payerId null", () => {
    const r = parseExpenseLine("450 dinner with rahul", members);
    expect(r.payerId).toBeNull();
  });

  it("description is empty string when line is only an amount and names", () => {
    const r = parseExpenseLine("450 with rahul and priya", members);
    expect(r.description).toBe("");
  });

  it("a member is never listed twice", () => {
    const r = parseExpenseLine("450 dinner with rahul and rahul", members);
    expect(r.participantIds).toEqual([rahul.id]);
  });
});

describe("parseExpenseLine - name matching", () => {
  it("ambiguous first-name match: neither matched, token reported unmatched", () => {
    const twoRahuls: NlMember[] = [
      { id: "m1", name: "Rahul Sharma" },
      { id: "m2", name: "Rahul Verma" },
    ];
    const r = parseExpenseLine("200 rahul", twoRahuls);
    expect(r.participantIds).toEqual([]);
    expect(r.unmatched).toContain("rahul");
  });

  it("unmatched name after connector is reported, not swallowed into description", () => {
    const r = parseExpenseLine("300 lunch with zoya", members);
    expect(r.description).toBe("lunch");
    expect(r.unmatched).toContain("zoya");
    expect(r.participantIds).toEqual([]);
  });

  it("unrelated words with no connector are left in description, not flagged unmatched", () => {
    const r = parseExpenseLine("450 dinner", members);
    expect(r.description).toBe("dinner");
    expect(r.unmatched).toEqual([]);
  });

  it("unambiguous prefix match (>=3 chars) resolves to the member", () => {
    const r = parseExpenseLine("300 taxi with priy", members);
    expect(r.participantIds).toEqual([priya.id]);
  });

  it("case-insensitive matching", () => {
    const r = parseExpenseLine("450 dinner with RAHUL", members);
    expect(r.participantIds).toEqual([rahul.id]);
  });
});

describe("parseExpenseLine - never throws, returns safe defaults", () => {
  it("empty string", () => {
    const r = parseExpenseLine("", members);
    expect(r.total).toBeNull();
    expect(r.description).toBe("");
    expect(r.participantIds).toEqual([]);
    expect(r.payerId).toBeNull();
    expect(r.unmatched).toEqual([]);
  });

  it("whitespace-only input", () => {
    const r = parseExpenseLine("   \n\t  ", members);
    expect(r.total).toBeNull();
  });

  it("no-amount input", () => {
    const r = parseExpenseLine("lunch with rahul", members);
    expect(r.total).toBeNull();
    expect(r.participantIds).toEqual([rahul.id]);
  });

  it("only punctuation", () => {
    expect(() => parseExpenseLine("!!! ,,, &&&", members)).not.toThrow();
  });

  it("emoji", () => {
    expect(() => parseExpenseLine("450 🍕🎉 with rahul", members)).not.toThrow();
  });

  it("a very long input (10,000 chars) does not throw and returns safely", () => {
    const long = "450 dinner with rahul and " + "x".repeat(10000);
    expect(() => parseExpenseLine(long, members)).not.toThrow();
    const r = parseExpenseLine(long, members);
    expect(r.total).toBe(45000); // ₹450
  });
});

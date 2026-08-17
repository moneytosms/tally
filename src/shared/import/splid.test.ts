import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { parseSplidXls } from "~/shared/import/splid";

/** Builds a workbook matching Splid's export shape: a header row of
 *  [Title, Amount, Currency, By, Date, Created on, <Name>, '', <Name>, '', ...]
 *  followed by data rows, then an in-memory .xls buffer - same shape
 *  `read()` will hand back when a real Splid file is uploaded. */
function buildSplidWorkbook(rows: unknown[][]) {
  const ws = utils.aoa_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Summary");
  return write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;
}

describe("parseSplidXls", () => {
  it("parses paid/share pairs into normalized shares, ignoring the paid column", () => {
    const buf = buildSplidWorkbook([
      ["10 gpa gang", "", "", "", "", ""],
      ["Created with Splid", "", "", "", "", ""],
      [],
      ["Title", "Amount", "Currency", "By", "Date", "Created on", "Nidhi", "", "Nivy", ""],
      // Nidhi paid 250, split evenly with Nivy (125 each).
      ["Auto from college", 250, "INR", "Nidhi", "", "8/16/26", 250, -125, "", -125],
    ]);

    const result = parseSplidXls(buf);
    expect(result.warnings).toEqual([]);
    expect(result.sourceNames.sort()).toEqual(["Nidhi", "Nivy"]);
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({ title: "Auto from college", amountPaise: 25_000, payerName: "Nidhi" });
    expect(row!.shares.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Nidhi", sharePaise: 12_500 },
      { name: "Nivy", sharePaise: 12_500 },
    ]);
  });

  it("skips non-INR rows with a warning instead of throwing", () => {
    const buf = buildSplidWorkbook([
      ["Title", "Amount", "Currency", "By", "Date", "Created on", "A", "", "B", ""],
      ["Dollar thing", 10, "USD", "A", "", "8/16/26", 10, -5, "", -5],
    ]);

    const result = parseSplidXls(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Dollar thing/);
  });

  it("skips the trailing blank-title totals row", () => {
    const buf = buildSplidWorkbook([
      ["Title", "Amount", "Currency", "By", "Date", "Created on", "A", "", "B", ""],
      ["Bus", 100, "INR", "A", "", "8/16/26", 100, -50, "", -50],
      ["", "", "", "", "", "", -50, "", 50, ""],
    ]);

    const result = parseSplidXls(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.title).toBe("Bus");
  });

  it("rounds float shares to the nearest paisa without throwing", () => {
    const buf = buildSplidWorkbook([
      ["Title", "Amount", "Currency", "By", "Date", "Created on", "A", "", "B", "", "C", ""],
      // ₹50 split three ways: 16.666666666666668 repeating.
      ["Auto", 50, "INR", "A", "", "8/16/26", 50, -16.666666666666668, "", -16.666666666666668, "", -16.666666666666664],
    ]);

    const result = parseSplidXls(buf);
    expect(result.rows).toHaveLength(1);
    const total = result.rows[0]!.shares.reduce((a, s) => a + s.sharePaise, 0);
    // Rounding each share independently need not sum exactly to amountPaise -
    // resolveSplits (mode "shares") fixes that at commit time, not here.
    expect(total).toBeGreaterThan(4_900);
    expect(total).toBeLessThan(5_100);
  });
});

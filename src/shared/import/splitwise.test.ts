import { describe, expect, it } from "vitest";
import { parseSplitwiseCsv } from "~/shared/import/splitwise";

describe("parseSplitwiseCsv", () => {
  it("derives payer and shares from net-balance columns", () => {
    // Ada paid ₹100, split evenly with Bob (₹50 each). Ada's net = +50, Bob's = -50.
    const csv = ["Date,Description,Category,Cost,Currency,Ada,Bob", "2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00"].join("\n");

    const result = parseSplitwiseCsv(csv);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({ title: "Auto", amountPaise: 10_000, payerName: "Ada" });
    expect(row!.shares.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Ada", sharePaise: 5_000 },
      { name: "Bob", sharePaise: 5_000 },
    ]);
  });

  it("skips the trailing 'Total balance' row (non-numeric Cost)", () => {
    const csv = [
      "Date,Description,Category,Cost,Currency,Ada,Bob",
      "2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00",
      "Total balance,,,,,,",
    ].join("\n");

    const result = parseSplitwiseCsv(csv);
    expect(result.rows).toHaveLength(1);
  });

  it("skips a row with zero or more than one positive net balance, with a warning", () => {
    const csv = [
      "Date,Description,Category,Cost,Currency,Ada,Bob",
      "2026-08-16,Ambiguous,General,100.00,INR,50.00,50.00", // two positives
      "2026-08-16,AllNegative,General,100.00,INR,-50.00,-50.00", // no positive
    ].join("\n");

    const result = parseSplitwiseCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = ['Date,Description,Category,Cost,Currency,Ada,Bob', '2026-08-16,"Dinner, drinks incl.",Food,100.00,INR,50.00,-50.00'].join(
      "\n",
    );

    const result = parseSplitwiseCsv(csv);
    expect(result.rows[0]!.title).toBe("Dinner, drinks incl.");
  });

  it("rejects non-INR rows with a warning", () => {
    const csv = ["Date,Description,Category,Cost,Currency,Ada,Bob", "2026-08-16,Coffee,Food,5.00,USD,2.50,-2.50"].join("\n");

    const result = parseSplitwiseCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});

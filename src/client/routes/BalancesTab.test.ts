// Pure arithmetic behind the bulk settle note. Amounts are paise, written as integers
// with the rupee value in a comment.
import { describe, expect, it } from "vitest";
import { bulkNoteShown, bulkNotRecorded, bulkRemainder, queryView } from "./BalancesTab";

describe("bulkNotRecorded", () => {
  it("does not count duplicates, which were already recorded", () => {
    expect(bulkNotRecorded([{ reason: "duplicate" }, { reason: "guest" }, { reason: "duplicate" }])).toBe(1);
    expect(bulkNotRecorded([{ reason: "duplicate" }])).toBe(0);
    expect(bulkNotRecorded([])).toBe(0);
  });
});

describe("bulkRemainder", () => {
  it("is zero when the recorded total matches the row", () => {
    // net 500.00 owed by viewer, 500.00 recorded
    expect(bulkRemainder(50000, 50000)).toBe(0);
  });

  it("is what the friend still owes the viewer after recording", () => {
    // viewer owes 300.00 net (30000); legs 500.00 (50000) recorded; Asha owes 200.00 back elsewhere (20000)
    expect(bulkRemainder(30000, 50000)).toBe(20000);
  });

  it("shows the note only for a positive remainder", () => {
    // remainder 200.00 (20000): friend owes viewer, note shown
    expect(bulkNoteShown(bulkRemainder(30000, 50000))).toBe(true);
    // remainder 0: row and sheet agree, no note
    expect(bulkNoteShown(bulkRemainder(50000, 50000))).toBe(false);
    // remainder -100.00 (-10000): viewer still owes friend, "owes you" would be false, no note
    expect(bulkNoteShown(bulkRemainder(40000, 30000))).toBe(false);
  });
});

describe("queryView", () => {
  it("is loading, never settled, before data arrives", () => {
    expect(queryView({ data: undefined, isError: false })).toBe("loading");
  });

  it("is an error, never settled, when the first request fails", () => {
    expect(queryView({ data: undefined, isError: true })).toBe("error");
  });

  it("is empty only once data has arrived with no rows", () => {
    expect(queryView({ data: [], isError: false })).toBe("empty");
  });

  it("is rows when data exists, even if a background refetch failed", () => {
    expect(queryView({ data: [{}], isError: true })).toBe("rows");
  });
});

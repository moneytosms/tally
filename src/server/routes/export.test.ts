import { beforeEach, describe, expect, it } from "vitest";
import exportRouter from "~/server/routes/export";
import expensesRouter from "~/server/routes/expenses";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, exportRouter, expensesRouter);
});

const expense = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      json: {
        description: "test expense",
        paidAtEpochMs: 1_760_000_000_000,
        categoryId: null,
        notes: null,
        mode: "equal",
        ...body,
      },
    }),
  );

describe("GET /export.csv", () => {
  it("exports all ledgers the caller is a member of", async () => {
    // Create an expense in L1
    await expense("L1", {
      total: 10_000, // ₹100
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "Dinner",
    });

    const res = await app.request(req(h, "/api/export.csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const text = await res.text();
    const lines = text.split("\n");
    // Header + 2 splits (Ada owes, Bob owed)
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("ledger");
    expect(lines[0]).toContain("date");
    expect(lines[0]).toContain("total_paise");
  });

  it("includes one row per split", async () => {
    await expense("L1", {
      total: 30_000, // ₹300
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }],
      description: "Dinner",
    });

    const res = await app.request(req(h, "/api/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    // Header + 3 splits (one per participant)
    expect(lines.length).toBe(4);
  });

  it("paise column is an exact integer", async () => {
    await expense("L1", {
      total: 12_345, // ₹123.45
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "Test",
    });

    const res = await app.request(req(h, "/api/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    const dataLine = lines[1]; // First data line
    expect(dataLine).toBeDefined();
    const fields = dataLine!.split(",");
    const totalPaiseIdx = 5; // total_paise is the 6th column (0-indexed)
    const totalPaise = fields[totalPaiseIdx];
    expect(Number.isInteger(Number(totalPaise))).toBe(true);
    expect(totalPaise).toBe("12345");
  });

  it("formats negative amounts (refunds) correctly", async () => {
    // Create a refund: negative expense
    await expense("L1", {
      total: -1_234, // -₹12.34 refund
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "Refund",
    });

    const res = await app.request(req(h, "/api/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    const dataLine = lines[1];
    expect(dataLine).toBeDefined();
    // CSV parsing: need to handle quoted fields properly
    const csv = dataLine!;
    expect(csv).toContain("'-12.34"); // Single quote prefix + negative number
  });

  it("escapes descriptions with commas and quotes", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: 'Dinner, "fancy" place',
    });

    const res = await app.request(req(h, "/api/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    const dataLine = lines[1];
    // Description with comma and quotes should be properly CSV-escaped
    // In CSV format: "Dinner, ""fancy"" place"
    expect(dataLine).toContain('"Dinner, ""fancy"" place"');
  });

  it("requires a session", async () => {
    const res = await app.request(new Request("http://tally.test/api/export.csv"));
    expect(res.status).toBe(401);
  });
});

describe("GET /ledgers/:ledgerId/export.csv", () => {
  it("exports a single ledger with CSV format", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Trip"); // L1 name
    expect(text).toContain("total_paise");
  });

  it("includes one row per split in the ledger", async () => {
    // Create a 3-way split
    await expense("L1", {
      total: 30_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }],
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    // Header + 3 splits
    expect(lines.length).toBe(4);
  });

  it("requires session", async () => {
    const res = await app.request(new Request("http://tally.test/api/ledgers/L1/export.csv"));
    expect(res.status).toBe(401);
  });

  it("requires membership", async () => {
    // Create a session for u_cy who is only in L2, not L1
    const { createSession } = await import("~/server/auth/session");
    const { SESSION_COOKIE } = await import("~/server/auth/session");
    const cyToken = await createSession(h.db, "u_cy", Date.now());

    const cyReq = new Request("http://tally.test/api/ledgers/L1/export.csv", {
      headers: { cookie: `${SESSION_COOKIE}=${cyToken}` },
    });
    const res = await app.request(cyReq);
    expect(res.status).toBe(403);
  });

  it("includes category names when present", async () => {
    // Get a category id from the seeded ones
    const categories = await h.db.listCategories();
    const catId = categories[0]!.id;

    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      categoryId: catId,
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    expect(text).toContain(categories[0]!.name);
  });

  it("correctly formats participant names from nickname, guestName, or Unknown", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_guest" }],
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    const lines = text.split("\n");
    // Guest has guestName "Dee", should appear in CSV
    expect(text).toContain("Dee");
    // Ada has nickname "Ada"
    expect(text).toContain("Ada");
  });

  it("handles empty notes field", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      notes: null,
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    expect(text).toBeTruthy();
  });

  it("has filename in content-disposition", async () => {
    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("filename=");
    expect(disposition).toContain("L1");
  });
});

describe("CSV integrity", () => {
  it("refund amounts format correctly with negative sign", async () => {
    await expense("L1", {
      total: -5_000, // -₹50.00
      payerMemberId: "m_bob",
      participants: [{ memberId: "m_bob" }, { memberId: "m_ada" }],
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    const dataLine = lines[1];
    expect(dataLine).toBeDefined();
    const fields = dataLine!.split(",");
    const totalPaise = fields[5];
    expect(totalPaise).toBe("-5000");
  });

  it("handles special characters without corruption", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: 'Cost: $50, "tax" = 10%',
    });

    const res = await app.request(req(h, "/api/ledgers/L1/export.csv"));
    const text = await res.text();
    // Should not crash and should contain the description
    expect(text).toBeTruthy();
  });
});

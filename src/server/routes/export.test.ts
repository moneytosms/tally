import { beforeEach, describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import balancesRouter from "~/server/routes/balances";
import exportRouter from "~/server/routes/export";
import expensesRouter from "~/server/routes/expenses";
import settlementsRouter from "~/server/routes/settlements";
import { type Harness, NOW, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, exportRouter, expensesRouter, settlementsRouter, balancesRouter);
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
    expect(csv).toContain("-12.34");
    expect(csv).not.toContain("'-12.34"); // plain signed decimal: no formula guard
  });

  it("guards descriptions that start with =, a tab or a carriage return", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "=SUM(A1)",
    });
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "Tabbed",
    });
    // The API trims descriptions, so set the leading tab directly in the DB.
    h.sql.prepare("UPDATE expenses SET description = ? WHERE description = ?").run("\tTabbed", "Tabbed");

    const text = await (await app.request(req(h, "/api/export.csv"))).text();
    expect(text).toContain("'=SUM(A1)");
    expect(text).toContain("'\tTabbed");
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

const settle = (ledgerId: string, body: object) =>
  app.request(
    req(h, `/api/ledgers/${ledgerId}/settlements`, {
      method: "POST",
      json: { method: "manual", note: null, ...body },
    }),
  );

/** Rows of one CSV section: the lines after its title, up to the blank line. Fixture names have no commas. */
function csvSection(text: string, title: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  const start = lines.indexOf(title);
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end).map((l) => l.split(","));
}

describe("dates and BOM", () => {
  it("dates an expense in IST, not UTC", async () => {
    // 18:30Z is local midnight in India, so the day is the 16th
    await expense("L1", {
      total: 10_000, // ₹100
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      paidAtEpochMs: Date.parse("2026-08-15T18:30:00Z"),
    });

    const text = await (await app.request(req(h, "/api/ledgers/L1/export.csv"))).text();
    expect(text.split("\n")[1]!.split(",")[1]).toBe("2026-08-16");
  });

  it("prefixes the per-ledger CSV with a UTF-8 BOM", async () => {
    const bytes = new Uint8Array(await (await app.request(req(h, "/api/ledgers/L1/export.csv"))).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // text() would strip the BOM
  });
});

describe("GET /ledgers/:ledgerId/settle.csv", () => {
  it("starts with a BOM and holds all five sections in order", async () => {
    await expense("L1", {
      total: 10_000, // ₹100
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });

    const res = await app.request(req(h, "/api/ledgers/L1/settle.csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("tally-settle-L1.csv");
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();

    const titles = ["Net positions", "Transfer plan", "Direct debts", "Settlements", "Expenses"];
    const at = titles.map((t) => text.split("\n").indexOf(t));
    at.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("net positions match /balances and sum to zero", async () => {
    await expense("L1", {
      total: 30_000, // ₹300
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }, { memberId: "m_guest" }],
    });
    await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 2_000 }); // ₹20

    const text = await (await app.request(req(h, "/api/ledgers/L1/settle.csv"))).text();
    const rows = csvSection(text, "Net positions").slice(1); // drop header
    const bal = (await (await app.request(req(h, "/api/ledgers/L1/balances"))).json()) as {
      positions: Array<{ name: string; net: number }>;
    };

    expect(rows.length).toBe(bal.positions.length);
    for (const p of bal.positions) {
      const row = rows.find((r) => r[0] === p.name);
      expect(Number(row![9])).toBe(p.net); // net_paise
    }
    expect(rows.reduce((sum, r) => sum + Number(r[9]), 0)).toBe(0);
  });

  it("debtor net_inr is a plain negative rupee amount, no formula guard", async () => {
    await expense("L1", {
      total: 4_000, // ₹40, split two ways: Bob owes ₹20
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });

    const text = await (await app.request(req(h, "/api/ledgers/L1/settle.csv"))).text();
    const row = csvSection(text, "Net positions").find((r) => r[9] === "-2000"); // net_paise = -₹20
    expect(row).toBeDefined();
    expect(row![10]).toBe("-20.00"); // net_inr
    expect(text).not.toContain("'-20.00");
  });

  it("leaves out soft-deleted expenses and settlements", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
      description: "Gone expense",
    });
    await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 1_000, note: "Gone settle" });
    h.sql.prepare("UPDATE expenses SET deleted_at = ? WHERE description = ?").run(NOW, "Gone expense");
    h.sql.prepare("UPDATE settlements SET deleted_at = ? WHERE note = ?").run(NOW, "Gone settle");

    const text = await (await app.request(req(h, "/api/ledgers/L1/settle.csv"))).text();
    expect(text).not.toContain("Gone expense");
    expect(text).not.toContain("Gone settle");
    expect(csvSection(text, "Net positions")).toHaveLength(1); // header only
  });

  it("never includes a VPA", async () => {
    await expense("L1", {
      total: 10_000,
      payerMemberId: "m_ada",
      participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }],
    });
    await settle("L1", { fromMemberId: "m_bob", toMemberId: "m_ada", amount: 1_000 });

    const csv = await (await app.request(req(h, "/api/ledgers/L1/settle.csv"))).text();
    expect(csv).not.toContain("@bank");

    const xlsx = await (await app.request(req(h, "/api/ledgers/L1/settle.xlsx"))).arrayBuffer();
    const wb = read(new Uint8Array(xlsx), { type: "array" });
    for (const sheet of Object.values(wb.Sheets)) expect(utils.sheet_to_csv(sheet)).not.toContain("@bank");
  });

  it("requires membership", async () => {
    const { createSession, SESSION_COOKIE } = await import("~/server/auth/session");
    const cyToken = await createSession(h.db, "u_cy", Date.now());
    for (const path of ["settle.csv", "settle.xlsx"]) {
      const cyReq = new Request(`http://tally.test/api/ledgers/L1/${path}`, {
        headers: { cookie: `${SESSION_COOKIE}=${cyToken}` },
      });
      expect((await app.request(cyReq)).status).toBe(403);
    }
  });
});

describe("GET /ledgers/:ledgerId/settle.xlsx", () => {
  it("parses back with the five sheet names", async () => {
    const res = await app.request(req(h, "/api/ledgers/L1/settle.xlsx"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("tally-settle-L1.xlsx");

    const wb = read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    expect(wb.SheetNames).toEqual(["Net positions", "Transfer plan", "Direct debts", "Settlements", "Expenses"]);
  });
});

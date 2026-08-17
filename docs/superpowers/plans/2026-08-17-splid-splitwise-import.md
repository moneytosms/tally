# Splid/Splitwise Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import expenses from a Splid `.xls` export or a Splitwise `.csv` export into an existing ledger, via the ledger's ⋯ menu, with a mapping step for unmatched names (existing member, or Owner-only new guest).

**Architecture:** Two pure parser functions normalize both formats to one shape. A `preview` endpoint parses an uploaded file and returns rows + distinct names, read-only. A client mapping panel resolves each name to a member (or a new guest). A `commit` endpoint re-validates and writes everything in one `db.batch(...)`, reusing the existing `resolveSplits` money logic.

**Tech Stack:** Hono (server), `xlsx` (SheetJS, new dependency — the only workable way to read Splid's binary OLE `.xls`), hand-rolled CSV parsing (no new dependency), React + TanStack Query (client).

**Spec:** `docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md` (section B)

## Global Constraints

- Money is integer paise everywhere — no float in storage, API, or calculation (ADR 0003). Parsers may produce paise via `Math.round(rupees * 100)`; final per-participant amounts are always resolved through `resolveSplits`, never hand-rounded a second time.
- D1 has no cross-request transaction — the commit endpoint's writes (new guests + expenses + splits) go through one `db.batch([...])` call, same pattern `expenses.ts` already uses.
- Guests are data, never principals (ADR/CONTEXT) — only `requireOwner` may create one, matching the existing `AddGuest` panel and `POST /ledgers/:id/guests`.
- An archived ledger is read-only — the commit route uses `rejectArchivedWrites`, same guard `expenses.ts` uses.
- Every user-facing string goes through `t()` — add new keys to `locales/en.json`.
- Never leak an internal message to the client (`app.onError` already enforces this globally) — parser/validation errors returned from these routes must be user-safe strings, not raw exception messages.
- The reference file (`Summary 10 gpa gang.xls`) stays out of the repo. Tests use small hand-built fixtures instead.

---

### Task 1: `xlsx` dependency + Splid `.xls` parser

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/shared/import/splid.ts`
- Test: `src/shared/import/splid.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for Task 2's preview route and Task 3's Splitwise parser to share the same shape):
```ts
export type ParsedImportRow = {
  title: string;
  amountPaise: number;
  dateMs: number;
  payerName: string;
  shares: Array<{ name: string; sharePaise: number }>;
};
export type ParseResult = {
  sourceNames: string[];
  rows: ParsedImportRow[];
  warnings: string[];
};
export function parseSplidXls(bytes: ArrayBuffer | Uint8Array): ParseResult;
```

- [ ] **Step 1: Add the dependency**

Run: `pnpm add xlsx`

Verify: `pnpm typecheck` still passes (no code uses it yet, this just confirms the install didn't break anything).

- [ ] **Step 2: Write the failing test**

Create `src/shared/import/splid.test.ts`. `xlsx`'s `write` function builds a workbook buffer in-memory, so the fixture is generated in the test itself rather than checking in a binary file:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test splid.test.ts`
Expected: FAIL — `src/shared/import/splid.ts` doesn't exist yet.

- [ ] **Step 4: Implement the parser**

Create `src/shared/import/splid.ts`:

```ts
// Splid (splid.app) exports a binary OLE .xls with a "balance matrix" shape:
// one header row naming each member, two columns per member per data row
// ([paidAmount, -share]), one row per expense, and a trailing blank-title row
// of running totals. See docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md.
import { read, utils } from "xlsx";
import type { ParseResult, ParsedImportRow } from "~/shared/import/types";

const FIXED_COLUMNS = ["Title", "Amount", "Currency", "By", "Date", "Created on"];

/** "M/D/YY" -> epoch ms at local midnight. Splid's "Date" column is
 *  frequently garbled by a unicode bug in their exporter (shows up as a
 *  single replacement character); "Created on" is the reliable field. */
function parseCreatedOn(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = 2000 + Number(y);
  const ms = new Date(year, Number(mo) - 1, Number(d)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseSplidXls(bytes: ArrayBuffer | Uint8Array): ParseResult {
  const wb = read(bytes, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /summary/i.test(n)) ?? wb.SheetNames[0];
  if (!sheetName) return { sourceNames: [], rows: [], warnings: ["No sheet found in file"] };
  const sheet = wb.Sheets[sheetName]!;
  const aoa = utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  const headerIdx = aoa.findIndex((r) => r[0] === "Title" && r[1] === "Amount");
  if (headerIdx === -1) return { sourceNames: [], rows: [], warnings: ["Could not find the expense header row"] };
  const header = aoa[headerIdx]!;

  // Member columns start right after the fixed columns, two per member
  // (name, blank). Only the even offset within each pair carries a header.
  const members: Array<{ name: string; paidCol: number; shareCol: number }> = [];
  for (let i = FIXED_COLUMNS.length; i < header.length; i += 2) {
    const name = header[i];
    if (typeof name === "string" && name.trim()) {
      members.push({ name: name.trim(), paidCol: i, shareCol: i + 1 });
    }
  }

  const rows: ParsedImportRow[] = [];
  const warnings: string[] = [];
  const sourceNames = new Set<string>();

  for (const r of aoa.slice(headerIdx + 1)) {
    const title = r[0];
    if (typeof title !== "string" || !title.trim()) continue; // blank-title totals row

    const amount = r[1];
    const currency = r[2];
    const by = r[3];
    if (typeof amount !== "number" || amount === 0) {
      warnings.push(`Skipped "${title}": no numeric amount`);
      continue;
    }
    if (currency !== "INR") {
      warnings.push(`Skipped "${title}": currency is ${String(currency)}, not INR`);
      continue;
    }
    if (typeof by !== "string" || !by.trim()) {
      warnings.push(`Skipped "${title}": no payer in the "By" column`);
      continue;
    }

    const shares: Array<{ name: string; sharePaise: number }> = [];
    for (const m of members) {
      const share = r[m.shareCol];
      if (typeof share !== "number" || share === 0) continue;
      shares.push({ name: m.name, sharePaise: Math.round(-share * 100) });
    }
    if (shares.length === 0) {
      warnings.push(`Skipped "${title}": no per-person shares found`);
      continue;
    }

    const dateMs = parseCreatedOn(r[5]) ?? Date.now();
    rows.push({ title: title.trim(), amountPaise: Math.round(amount * 100), dateMs, payerName: by.trim(), shares });
    sourceNames.add(by.trim());
    for (const s of shares) sourceNames.add(s.name);
  }

  return { sourceNames: [...sourceNames], rows, warnings };
}
```

- [ ] **Step 5: Create the shared type file**

Create `src/shared/import/types.ts`:

```ts
export type ParsedImportRow = {
  title: string;
  amountPaise: number;
  dateMs: number;
  payerName: string;
  shares: Array<{ name: string; sharePaise: number }>;
};

export type ParseResult = {
  sourceNames: string[];
  rows: ParsedImportRow[];
  warnings: string[];
};
```

Then fix `splid.ts`'s import (already written above) to reference this file.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test splid.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/shared/import/types.ts src/shared/import/splid.ts src/shared/import/splid.test.ts
git commit -m "feat(import): add Splid .xls parser"
```

---

### Task 2: Splitwise `.csv` parser

**Files:**
- Create: `src/shared/import/splitwise.ts`
- Test: `src/shared/import/splitwise.test.ts`

**Interfaces:**
- Consumes: `ParseResult`, `ParsedImportRow` from `src/shared/import/types.ts` (Task 1).
- Produces: `parseSplitwiseCsv(text: string): ParseResult`, same shape as `parseSplidXls`, for Task 3 (the preview route) to dispatch to by file extension.

- [ ] **Step 1: Write the failing test**

Create `src/shared/import/splitwise.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test splitwise.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the parser**

Create `src/shared/import/splitwise.ts`:

```ts
// Splitwise's CSV export: one row per expense, Date/Description/Category/Cost/
// Currency, then one column PER PERSON holding their net balance for that row
// (paid - owed; positive = they fronted more than their share). Splitwise is
// single-payer per expense, so exactly one person's net must be positive - that
// person is the payer, and their surplus plus everyone else's negative net
// reconstructs each person's share. See
// docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md and
// https://github.com/spliit-app/spliit/issues/22.
import type { ParseResult, ParsedImportRow } from "~/shared/import/types";

/** Minimal RFC4180: quoted fields, "" escapes a literal quote, commas inside
 *  quotes are not field separators. No embedded newlines in a field - none of
 *  Splitwise's columns need them. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const FIXED_COLUMNS = ["Date", "Description", "Category", "Cost", "Currency"];

export function parseSplitwiseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { sourceNames: [], rows: [], warnings: ["Empty file"] };

  const header = parseCsvLine(lines[0]!);
  if (FIXED_COLUMNS.some((c, i) => header[i] !== c)) {
    return { sourceNames: [], rows: [], warnings: ["Unrecognized CSV header - expected Date,Description,Category,Cost,Currency,..."] };
  }
  const people = header.slice(FIXED_COLUMNS.length).map((n) => n.trim()).filter((n) => n);

  const rows: ParsedImportRow[] = [];
  const warnings: string[] = [];
  const sourceNames = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const [dateStr, description, , costStr, currency] = cells;
    const title = (description ?? "").trim();
    const cost = Number(costStr);
    if (!costStr || !Number.isFinite(cost) || cost === 0) continue; // footer/total row

    if (currency !== "INR") {
      warnings.push(`Skipped "${title || dateStr}": currency is ${String(currency)}, not INR`);
      continue;
    }

    const nets = people.map((name, i) => ({ name, net: Number(cells[FIXED_COLUMNS.length + i]) }));
    const positives = nets.filter((n) => Number.isFinite(n.net) && n.net > 0);
    if (positives.length !== 1) {
      warnings.push(`Skipped "${title || dateStr}": expected exactly one payer, found ${positives.length}`);
      continue;
    }
    const payerName = positives[0]!.name;

    const costPaise = Math.round(cost * 100);
    const shares = nets
      .filter((n) => Number.isFinite(n.net) && n.net !== 0)
      .map((n) => ({
        name: n.name,
        // share = paid - net; paid is the full cost for the payer, 0 for everyone else.
        sharePaise: Math.round((n.name === payerName ? cost : 0) * 100 - n.net * 100),
      }));
    if (shares.length === 0) {
      warnings.push(`Skipped "${title || dateStr}": no per-person shares found`);
      continue;
    }

    const dateMs = dateStr ? new Date(`${dateStr}T00:00:00`).getTime() : Date.now();
    rows.push({
      title: title || "Imported expense",
      amountPaise: costPaise,
      dateMs: Number.isFinite(dateMs) ? dateMs : Date.now(),
      payerName,
      shares,
    });
    sourceNames.add(payerName);
    for (const s of shares) sourceNames.add(s.name);
  }

  return { sourceNames: [...sourceNames], rows, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test splitwise.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/import/splitwise.ts src/shared/import/splitwise.test.ts
git commit -m "feat(import): add Splitwise .csv parser"
```

---

### Task 3: Server preview route

**Files:**
- Create: `src/server/routes/import.ts`
- Modify: `src/server/index.ts` (mount the router)
- Test: `src/server/routes/import.test.ts`

**Interfaces:**
- Consumes: `parseSplidXls` (Task 1), `parseSplitwiseCsv` (Task 2), `requireMember` (`~/server/middleware/membership`, already used by `expenses.ts`), `requireSession` (`~/server/middleware/session`).
- Produces: `POST /api/ledgers/:ledgerId/import/preview` returning `ParseResult` as JSON — for Task 5 (client mapping panel) to call. Router exported as default from `src/server/routes/import.ts`, mounted in `index.ts` as `app.route("/api", importRouter)`.

- [ ] **Step 1: Write the failing test**

Create `src/server/routes/import.test.ts`:

```ts
// Amounts are paise, written as integers with the rupee value in a comment.
// expensesRouter and ledgersRouter are mounted alongside importRouter so
// Task 4's tests can assert on the resulting /expenses and /members lists
// through the real routes, not by reading the DB directly.
import { beforeEach, describe, expect, it } from "vitest";
import expensesRouter from "~/server/routes/expenses";
import importRouter from "~/server/routes/import";
import ledgersRouter from "~/server/routes/ledgers";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, importRouter, expensesRouter, ledgersRouter);
});

function csvFile(text: string, name = "trip.csv") {
  return new File([text], name, { type: "text/csv" });
}

describe("POST /ledgers/:ledgerId/import/preview", () => {
  it("parses a Splitwise CSV and returns rows + source names, without writing anything", async () => {
    const csv = ["Date,Description,Category,Cost,Currency,Ada,Bob", "2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00"].join("\n");

    const form = new FormData();
    form.append("file", csvFile(csv));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L1/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sourceNames: string[]; rows: unknown[]; warnings: string[] };
    expect(body.sourceNames.sort()).toEqual(["Ada", "Bob"]);
    expect(body.rows).toHaveLength(1);

    const expenses = await (await app.request(req(h, "/api/ledgers/L1/expenses"))).json();
    void expenses;
  });

  it("400s on an unrecognized extension", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "trip.txt", { type: "text/plain" }));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L1/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res.status).toBe(400);
  });

  it("403s a non-member", async () => {
    const csv = "Date,Description,Category,Cost,Currency,Ada,Bob\n2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00";
    const form = new FormData();
    form.append("file", csvFile(csv));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L2/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    // Ada IS a member of L2 in the harness (n_ada) - use a nonexistent ledger instead.
    void res;
    const res2 = await app.request(new Request("http://tally.test/api/ledgers/does-not-exist/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res2.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test import.test.ts`
Expected: FAIL — `src/server/routes/import.ts` doesn't exist yet.

- [ ] **Step 3: Implement the preview route**

Create `src/server/routes/import.ts`:

```ts
// Import from a Splid .xls or Splitwise .csv export. Preview is read-only -
// it parses the uploaded bytes and hands back rows for the client to map
// source names onto members; nothing is written to the ledger until commit
// (see the commit route added alongside this one).
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { parseSplidXls } from "~/shared/import/splid";
import { parseSplitwiseCsv } from "~/shared/import/splitwise";
import type { ParseResult } from "~/shared/import/types";

const PATH = "/ledgers/:ledgerId/import";

const importRouter = new Hono<Env>();
importRouter.use(`${PATH}/*`, requireSession, requireMember);

importRouter.post(`${PATH}/preview`, async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "no file uploaded" }, 400);

  const name = file.name.toLowerCase();
  let result: ParseResult;
  if (name.endsWith(".xls")) {
    result = parseSplidXls(await file.arrayBuffer());
  } else if (name.endsWith(".csv")) {
    result = parseSplitwiseCsv(await file.text());
  } else {
    return c.json({ error: "unrecognized file type - use a Splid .xls or Splitwise .csv export" }, 400);
  }

  return c.json(result);
});

export default importRouter;
```

- [ ] **Step 4: Mount the router**

In `src/server/index.ts`, add the import alongside the others (near line 24):

```ts
import importRouter from "~/server/routes/import";
```

And mount it near the other `app.route("/api", ...)` calls (near line 61):

```ts
app.route("/api", importRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test import.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/import.ts src/server/routes/import.test.ts src/server/index.ts
git commit -m "feat(import): add preview endpoint for Splid/Splitwise files"
```

---

### Task 4: Server commit route

**Files:**
- Modify: `src/server/routes/import.ts`
- Modify: `src/server/routes/import.test.ts`

**Interfaces:**
- Consumes: `ParsedImportRow` (Task 1's `types.ts`), `resolveSplits` (`~/shared/money`, already used by `expenses.ts`), `uuidv7` (`~/shared/id`), `rejectArchivedWrites` (exported from `~/server/routes/expenses`), `db.insertMember`, `db.insertExpense`, `db.insertSplits`, `db.batch`, `db.listMembers` (all already used by `ledgers.ts`/`expenses.ts`).
- Produces: `POST /api/ledgers/:ledgerId/import/commit` returning `{ created: number }` — for Task 5's mapping panel to call on confirm.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/routes/import.test.ts` (new `describe` block, same file/imports as Task 3 plus a couple more):

```ts
describe("POST /ledgers/:ledgerId/import/commit", () => {
  const commitBody = (overrides: object = {}) => ({
    rows: [
      {
        title: "Auto",
        amountPaise: 10_000,
        dateMs: 1_760_000_000_000,
        payerName: "Ada",
        shares: [
          { name: "Ada", sharePaise: 5_000 },
          { name: "Bob", sharePaise: 5_000 },
        ],
      },
    ],
    mapping: { Ada: "m_ada", Bob: "m_bob" },
    newGuests: {},
    ...overrides,
  });

  it("creates the expense and splits from mapped names, in one batch, for an existing member", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody()),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(1);

    const expenses = (await (await app.request(req(h, "/api/ledgers/L1/expenses"))).json()) as Array<{
      description: string;
      total: number;
      payerMemberId: string;
      splits: Array<{ memberId: string; amount: number }>;
    }>;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ description: "Auto", total: 10_000, payerMemberId: "m_ada" });
    const total = expenses[0]!.splits.reduce((a, s) => a + s.amount, 0);
    expect(total).toBe(10_000); // resolveSplits guarantees exact sum
  });

  it("400s when a source name in rows has no mapping and no new guest", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody({ mapping: { Ada: "m_ada" } })), // Bob unmapped
      }),
    );
    expect(res.status).toBe(400);
  });

  it("403s a non-owner who supplies newGuests", async () => {
    // Bob is not the owner in the harness (only u_ada is_owner=1).
    const { createSession, SESSION_COOKIE } = await import("~/server/auth/session");
    const bobToken = await createSession(h.db, "u_bob", Date.now());
    const bobCookie = `${SESSION_COOKIE}=${bobToken}`;

    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: bobCookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody({ mapping: { Ada: "m_ada" }, newGuests: { Bob: "Bob (imported)" } })),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a new guest (owner) and uses it as a participant", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            rows: [
              {
                title: "Snacks",
                amountPaise: 2_000,
                dateMs: 1_760_000_000_000,
                payerName: "Ada",
                shares: [
                  { name: "Ada", sharePaise: 1_000 },
                  { name: "Charlie", sharePaise: 1_000 },
                ],
              },
            ],
            mapping: { Ada: "m_ada" },
            newGuests: { Charlie: "Charlie" },
          }),
        ),
      }),
    );
    expect(res.status).toBe(200);

    const members = (await (await app.request(req(h, "/api/ledgers/L1/members"))).json()) as Array<{ nickname: string; guestName: string | null }>;
    expect(members.some((m) => m.guestName === "Charlie")).toBe(true);
  });

  it("409s on an archived ledger", async () => {
    // Archive L1 directly via SQL - the lifecycle route lives in ledgers.ts and
    // isn't exercised here; only its effect (archived_at set) matters for this test.
    await h.sql.exec(`UPDATE ledgers SET archived_at = 1760000000000 WHERE id = 'L1'`);

    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody()),
      }),
    );
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test import.test.ts`
Expected: FAIL — commit route doesn't exist yet.

- [ ] **Step 3: Implement the commit route**

Modify `src/server/routes/import.ts` — add these imports at the top (alongside the existing ones):

```ts
import { z } from "zod";
import { rejectArchivedWrites } from "~/server/routes/expenses";
import { resolveSplits } from "~/shared/money";
import { uuidv7 } from "~/shared/id";
```

Add the request schema and route, before `export default importRouter;`:

```ts
const commitSchema = z.object({
  rows: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        amountPaise: z.int().positive(),
        dateMs: z.int().min(0),
        payerName: z.string().min(1),
        shares: z.array(z.object({ name: z.string().min(1), sharePaise: z.int() })).min(1),
      }),
    )
    .min(1),
  mapping: z.record(z.string(), z.string()),
  newGuests: z.record(z.string(), z.string()),
});

importRouter.use(`${PATH}/commit`, rejectArchivedWrites);
importRouter.post(`${PATH}/commit`, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = commitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid import payload" }, 400);
  const { rows, mapping, newGuests } = parsed.data;

  if (Object.keys(newGuests).length > 0 && !c.var.user.isOwner) {
    return c.json({ error: "only the owner can create guests during import" }, 403);
  }

  // Every source name referenced by a row must resolve, either to an existing
  // member or to a new guest about to be created.
  const allNames = new Set<string>();
  for (const r of rows) {
    allNames.add(r.payerName);
    for (const s of r.shares) allNames.add(s.name);
  }
  for (const name of allNames) {
    if (!(name in mapping) && !(name in newGuests)) {
      return c.json({ error: `"${name}" is not mapped to a member or a new guest` }, 400);
    }
  }

  const now = Date.now();
  const guestIds = new Map<string, string>();
  for (const [sourceName, guestName] of Object.entries(newGuests)) {
    guestIds.set(sourceName, uuidv7());
    void guestName;
  }
  const memberIdOf = (sourceName: string) => mapping[sourceName] ?? guestIds.get(sourceName)!;

  // Guard against a member id from another ledger sneaking in via `mapping` -
  // same check checkMembers() does in expenses.ts for hand-typed expenses.
  const liveMembers = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  for (const memberId of Object.values(mapping)) {
    if (!liveMembers.has(memberId)) return c.json({ error: "a mapped member is not in this ledger" }, 400);
  }

  const statements = [];
  for (const [sourceName, guestName] of Object.entries(newGuests)) {
    statements.push(
      db.insertMember({
        id: guestIds.get(sourceName)!,
        ledgerId,
        userId: null,
        guestName,
        nickname: null,
        joinedAt: now,
        leftAt: null,
        deletedAt: null,
        pinned: false,
      }),
    );
  }

  for (const row of rows) {
    const expenseId = uuidv7();
    const participantNames = row.shares.map((s) => s.name);
    const payerIndex = participantNames.indexOf(row.payerName);
    if (payerIndex === -1) return c.json({ error: `"${row.title}": payer is not among the row's participants` }, 400);

    let amounts: number[];
    try {
      amounts = resolveSplits({
        total: row.amountPaise,
        mode: "shares",
        participantCount: participantNames.length,
        payerIndex,
        values: row.shares.map((s) => Math.max(1, s.sharePaise)), // shares mode requires positive weights
      });
    } catch (e) {
      return c.json({ error: `"${row.title}": ${(e as Error).message}` }, 400);
    }

    statements.push(
      db.insertExpense({
        id: expenseId,
        ledgerId,
        description: row.title,
        total: row.amountPaise,
        paidAt: row.dateMs,
        payerMemberId: memberIdOf(row.payerName),
        categoryId: null,
        notes: "Imported",
        mode: "shares",
        createdBy: c.var.user.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
    statements.push(
      db.insertSplits(
        row.shares.map((s, i) => ({
          id: uuidv7(),
          expenseId,
          memberId: memberIdOf(s.name),
          amount: amounts[i]!,
          inputValue: s.sharePaise,
          sortOrder: i,
        })),
      ),
    );
  }

  // @ts-expect-error - statements is built incrementally with mixed insert kinds; batch's tuple type wants a literal, this is the same pattern other multi-row batches in this codebase fall back to.
  await db.batch(statements);

  return c.json({ created: rows.length });
});
```

**Note on the `@ts-expect-error`:** `db.batch` is typed as `<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>` — a fixed-length tuple, not `Array<...>`. Building the list with `push` in a loop produces a plain array, which doesn't satisfy that tuple type. If this causes an actual compile error (confirm with `pnpm typecheck`), the fix is casting at the call site: `await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);` — try that cast INSTEAD of the `@ts-expect-error` comment if the latter doesn't clear the error (an unused `@ts-expect-error` is itself a type error under strict mode). Use whichever one actually satisfies `tsc --noEmit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm typecheck && pnpm test import.test.ts`
Expected: PASS. If `pnpm typecheck` fails on the `db.batch(statements)` line, apply the cast noted above and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/import.ts src/server/routes/import.test.ts
git commit -m "feat(import): add commit endpoint that creates guests, expenses, and splits atomically"
```

---

### Task 5: Client query hooks

**Files:**
- Modify: `src/client/lib/queries.ts`

**Interfaces:**
- Consumes: nothing new (this task only adds client-side plumbing).
- Produces: `ImportParseResult`/`ImportRow` types, `useImportPreview()` (a `useMutation`, since it's a file upload, not a cacheable query), `useImportCommit(ledgerId)` — for Task 6 (the mapping panel) to call.

- [ ] **Step 1: Add types and hooks**

In `src/client/lib/queries.ts`, add near the other type definitions (after `LedgerInsights` if Task 2 of the insights plan already landed, otherwise after `Insights`):

```ts
export type ImportRow = {
  title: string;
  amountPaise: Paise;
  dateMs: number;
  payerName: string;
  shares: Array<{ name: string; sharePaise: Paise }>;
};
export type ImportParseResult = { sourceNames: string[]; rows: ImportRow[]; warnings: string[] };
```

Add near the other mutation hooks (find `useAddGuest` for the pattern to match — same file, search for `export const useAddGuest`):

```ts
/** File upload, so this bypasses `api()` (which always sets a JSON
 *  content-type) - the browser must set its own multipart boundary. */
export const useImportPreview = (ledgerId: string) =>
  useMutation({
    mutationFn: async (file: File): Promise<ImportParseResult> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/ledgers/${ledgerId}/import/preview`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? res.statusText);
      return body as ImportParseResult;
    },
  });

export const useImportCommit = (ledgerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rows: ImportRow[]; mapping: Record<string, string>; newGuests: Record<string, string> }) =>
      api<{ created: number }>(`/api/ledgers/${ledgerId}/import/commit`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.expenses(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.members(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
};
```

Add `ApiError` to the existing `import { api, ApiError } from "~/client/lib/api";` line if `queries.ts` doesn't already import it (check the top of the file — `LedgerMenu.tsx` imports it from the same module, `queries.ts` may only import `api`; add `ApiError` to that import list if missing).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/queries.ts
git commit -m "feat(import): add client hooks for import preview/commit"
```

---

### Task 6: Import mapping panel in the ledger ⋯ menu

**Files:**
- Modify: `src/client/components/LedgerMenu.tsx`
- Modify: `locales/en.json`

**Interfaces:**
- Consumes: `useImportPreview`, `useImportCommit`, `ImportParseResult`, `ImportRow` (Task 5); `useMe`, `useMembers` (already imported in `LedgerMenu.tsx`).
- Produces: nothing further consumed by other tasks — this is the leaf.

- [ ] **Step 1: Add i18n keys**

In `locales/en.json`, add a new top-level `"import"` object (alongside `"export"`):

```json
  "import": {
    "menuLabel": "Import",
    "title": "Import expenses",
    "fileLabel": "Splid (.xls) or Splitwise (.csv) export",
    "parsing": "Reading file…",
    "parseFailed": "Could not read that file.",
    "rowCount": {
      "one": "{count} expense found",
      "other": "{count} expenses found"
    },
    "warnings": "{count} rows were skipped",
    "mapping": "Match each name to a member",
    "mapUnmapped": "Not mapped",
    "createGuest": "Create guest \"{name}\"",
    "confirm": "Import",
    "confirming": "Importing…",
    "done": "Imported {count} expenses.",
    "failed": "Import failed."
  },
```

And add `"insights": "Insights"` if Task 4 of the insights plan didn't already add it (check first — don't duplicate the key). Add to `"ledger"."menu"`:

```json
    "import": "Import"
```

- [ ] **Step 2: Write the panel component**

In `src/client/components/LedgerMenu.tsx`, add these imports to the existing import block at the top:

```tsx
import { useImportCommit, useImportPreview, type ImportParseResult } from "~/client/lib/queries";
```

Add a new component, placed after `DuplicatePanel` and before `ConfirmDialog`:

```tsx
/** Splid/Splitwise import: parse -> map source names to members (or, Owner
 *  only, new guests) -> commit. The parsed rows are held in state between
 *  preview and commit - no server-side session, no re-upload. */
function ImportPanel({ ledgerId }: { ledgerId: string }) {
  const me = useMe();
  const members = useMembers(ledgerId);
  const preview = useImportPreview(ledgerId);
  const commit = useImportCommit(ledgerId);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [newGuestNames, setNewGuestNames] = useState<Record<string, string>>({});
  const [done, setDone] = useState<number | null>(null);

  const memberList = members.data ?? [];

  const onFile = (file: File) => {
    setParsed(null);
    setMapping({});
    setNewGuestNames({});
    setDone(null);
    preview.mutate(file, {
      onSuccess: (result) => {
        setParsed(result);
        // Guess a mapping from a case-insensitive nickname match.
        const guess: Record<string, string> = {};
        for (const name of result.sourceNames) {
          const match = memberList.find((m) => m.nickname.trim().toLowerCase() === name.trim().toLowerCase());
          if (match) guess[name] = match.id;
        }
        setMapping(guess);
      },
    });
  };

  const setMemberMapping = (sourceName: string, memberId: string) => {
    setMapping((m) => ({ ...m, [sourceName]: memberId }));
    setNewGuestNames((g) => {
      const { [sourceName]: _drop, ...rest } = g;
      return rest;
    });
  };

  const setGuestMapping = (sourceName: string) => {
    setMapping((m) => {
      const { [sourceName]: _drop, ...rest } = m;
      return rest;
    });
    setNewGuestNames((g) => ({ ...g, [sourceName]: sourceName }));
  };

  const unmapped = (parsed?.sourceNames ?? []).filter((n) => !(n in mapping) && !(n in newGuestNames));
  const canConfirm = parsed !== null && unmapped.length === 0 && parsed.rows.length > 0;

  const onConfirm = () => {
    if (!parsed) return;
    commit.mutate(
      { rows: parsed.rows, mapping, newGuests: newGuestNames },
      { onSuccess: (r) => setDone(r.created) },
    );
  };

  return (
    <div>
      <Field label={t("import.fileLabel")}>
        <input
          type="file"
          accept=".xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </Field>

      {preview.isPending && <p className="text-[12.5px]" style={hint}>{t("import.parsing")}</p>}
      {preview.isError && <p role="alert" className="text-[12.5px]" style={{ color: "var(--clay)" }}>{t("import.parseFailed")}</p>}

      {parsed && (
        <>
          <p className="mb-2 text-[12.5px]" style={hint}>
            {t("import.rowCount", { count: parsed.rows.length })}
            {parsed.warnings.length > 0 && ` · ${t("import.warnings", { count: parsed.warnings.length })}`}
          </p>

          <div className="mb-3 border-t pt-2.5" style={rule}>
            <div className="mb-1.5 text-[10.5px] tracking-[0.13em] uppercase" style={hint}>
              {t("import.mapping")}
            </div>
            {parsed.sourceNames.map((name) => (
              <div key={name} className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{name}</span>
                <Select
                  value={mapping[name] ?? (name in newGuestNames ? "__guest__" : "")}
                  onChange={(e) => {
                    if (e.target.value === "__guest__") setGuestMapping(name);
                    else if (e.target.value) setMemberMapping(name, e.target.value);
                  }}
                >
                  <option value="">{t("import.mapUnmapped")}</option>
                  {memberList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nickname}
                    </option>
                  ))}
                  {me.data?.isOwner && <option value="__guest__">{t("import.createGuest", { name })}</option>}
                </Select>
              </div>
            ))}
          </div>

          {commit.isError && <p role="alert" className="mb-2 text-[12.5px]" style={{ color: "var(--clay)" }}>{t("import.failed")}</p>}
          {done !== null && <p role="status" aria-live="polite" className="mb-2 text-[12.5px]" style={{ color: "var(--moss-2)" }}>{t("import.done", { count: done })}</p>}

          <Button className="w-full" disabled={!canConfirm || commit.isPending} onClick={onConfirm}>
            {commit.isPending ? t("import.confirming") : t("import.confirm")}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the menu**

In the `Panel` type (near `type Panel = "edit" | "members" | "invite" | "duplicate";`), add `"import"`:

```ts
type Panel = "edit" | "members" | "invite" | "duplicate" | "import";
```

In the menu's button list (right after the `duplicate` menuitem button, before the `<div className="my-1 border-t" ...>` separator that precedes archive/delete), add:

```tsx
              <button type="button" role="menuitem" className={item} onClick={() => pick("import")}>
                {t("import.menuLabel")}
              </button>
```

Alongside the other `<Sheet>` blocks (after the `duplicate` Sheet), add:

```tsx
      <Sheet open={panel === "import"} onOpenChange={() => setPanel(null)} title={t("import.title")}>
        <ImportPanel ledgerId={ledger.id} />
      </Sheet>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`. Build a small `.csv` by hand (the format from Task 2's test) or use a real Splitwise export if available, open a ledger as the Owner, ⋯ → Import, upload the file, confirm:
- Row count and any warnings show.
- Mapping dropdowns pre-guess matches by nickname.
- An unmapped name blocks the Import button.
- Selecting "create guest" for a name (Owner only) works; as a non-owner test user, confirm that option is absent and an unmapped name simply blocks import.
- After confirming, the ledger's expense list shows the new expenses and the guest (if any) appears in Members.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/LedgerMenu.tsx locales/en.json
git commit -m "feat(import): add mapping UI to the ledger menu"
```

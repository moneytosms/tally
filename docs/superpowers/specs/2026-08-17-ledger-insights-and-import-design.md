# Per-ledger insights + Splid/Splitwise import

Two independent sub-projects, one spec, one implementation pass. Both extend
existing patterns (`insights.ts`, `LedgerMenu.tsx`) rather than introducing new
architecture.

## A. Per-ledger insights

### Goal
Give a per-ledger breakdown (who spent/paid what, by category, by month),
distinct from the existing lifetime/global `InsightsTab`.

### Server
`GET /api/ledgers/:ledgerId/insights` — `requireSession, requireMember`.

Walks `db.listExpenses(ledgerId)` (soft-delete already filtered structurally,
per the data-access layer) and `db.listMembers(ledgerId)` once. Mirrors the
existing `src/server/routes/insights.ts` shapes but ledger-scoped and not
per-viewer:

```ts
type LedgerInsights = {
  totals: { spent: Paise; expenseCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: Paise; count: number }>;
  byMonth: Array<{ month: string; spent: Paise }>;
  byMember: Array<{ memberId: string; nickname: string; paid: Paise; share: Paise }>;
};
```

- `byCategory` / `byMonth` sum `expense.total` (not per-viewer shares — this is
  the whole ledger, not "my" spend). Same `monthKey`/`fillMonths` helpers,
  extracted to a small shared function so `insights.ts` and the new route
  don't duplicate them (existing file already has both; move to
  `src/server/insightsShared.ts` or keep inline — implementer's call, but no
  copy-paste of the UTC-month logic).
- `byMember`: for each member, `paid` = sum of `expense.total` where
  `payerMemberId === member.id`; `share` = sum of that member's
  `split.amount` across all expenses. Both walk the same expense list already
  fetched — no extra query.
- A member with `leftAt` set still appears if they have history (same
  reasoning as the existing activity feed) — don't filter them out.

### Client
- `qk.ledgerInsights = (ledgerId) => ["ledgers", ledgerId, "insights"]`,
  `useLedgerInsights(ledgerId)` in `queries.ts`.
- New route `src/client/routes/LedgerInsights.tsx` mounted at
  `/ledgers/:ledgerId/insights` in `App.tsx`, same lazy-route pattern as
  `RecurringTab`/`ActivityTab`.
- Link added in `LedgerDetail.tsx`'s existing Activity/Recurring link row.
- Reuses `CategoryChart`/`MonthChart` lazy-recharts pattern from
  `InsightsTab.tsx` — export them (or a shared factory) from a common module
  so both tabs pull from one `import("recharts")` chunk, not two.
- New `MemberPieChart` (lazy recharts `Pie`), rendered twice: "paid" and
  "share" datasets, using the same `CHART_COLORS` cycle. Each slice is
  never the only cue — a list under the chart (member name + `Amount`)
  carries the real numbers, same rule the bar charts already follow.
- No date-range filter in v1 (skip — a ledger is already a bounded trip;
  add later if asked).
- Empty state (`data.totals.expenseCount === 0`) reuses `t("empty.insights")`.

### New i18n keys
`insights.ledgerTitle`, `insights.byMember`, `insights.paid`,
`insights.share`, `ledger.menu.insights` (nav link label) — under existing
`insights.*` / `ledger.*` namespaces.

## B. Splid / Splitwise import

### Goal
Import expenses from a Splid `.xls` export or a Splitwise `.csv` export into
an existing ledger, with a mapping step for names that don't match a current
member (map to existing member, or — Owner only — create a new guest).

### Formats (both are a "balance matrix": one row per expense, one block of
columns per person)

**Splid `.xls`** (binary OLE `CDFV2`, not a zip/xlsx) — confirmed from the
sample file:
- Row 0-1: title/attribution, ignore.
- Row 3: header — `Title, Amount, Currency, By, Date, Created on`, then two
  columns per person (name, blank).
- Data rows: `Title, Amount, Currency, By(payer display name), Date(often
  garbled — Splid's ₹-adjacent unicode bug corrupts this cell), Created on
  ("M/D/YY")`, then per person: `[paidAmount, -share]` — blank cell pair if
  that person wasn't involved. `paidAmount` is redundant with
  `By`+`Amount`; only `-share` is used. Use `Created on` for the date, not
  the `Date` column.
- Trailing blank-title row: running totals, skip (detect via empty `Title`).
- Requires the `xlsx` (SheetJS) npm package — new dependency, justified: a
  real binary OLE spreadsheet format has no few-line parser.

**Splitwise `.csv`**:
- Header: `Date, Description, Category, Cost, Currency`, then one column per
  person = **net balance** = `paid − share` (positive = they're owed,
  negative = they owe). Confirmed via
  [spliit-app/spliit#22](https://github.com/spliit-app/spliit/issues/22) and
  [mawalu/splitwise-csv](https://github.com/mawalu/splitwise-csv).
- No `By` column — the payer is whoever's net balance is positive for that
  row (Splitwise is single-payer per expense, same assumption this app
  makes). If more than one person has a positive net for a row, or none do,
  treat the row as unparseable and surface it as a warning, not a crash.
- A footer "Total balance" row has a non-numeric or empty `Cost` — skip any
  row where `Cost` doesn't parse as a number.
- Plain CSV, RFC4180-ish (quoted fields, embedded commas) — hand-rolled
  parser, no new dependency.

### Normalized intermediate shape
Both parsers produce:
```ts
type ParsedImportRow = {
  title: string;
  amountPaise: Paise;      // Math.round(amount * 100)
  dateMs: number;
  payerName: string;       // raw source-file name, unmapped
  shares: Array<{ name: string; sharePaise: Paise }>; // raw source-file names
};
type ParseResult = {
  sourceNames: string[];   // union of payerName + all shares[].name, stable order of first appearance
  rows: ParsedImportRow[];
  warnings: string[];      // one per skipped/unparseable row, human-readable
};
```
- Currency: reject (warning, skip row) any row whose `Currency` isn't `INR`
  — this app is INR-only (ADR 0003).
- Rounding: source values are rupee floats with float-division tails (e.g.
  `16.666666666666668`). `Math.round(v * 100)` per share; do NOT try to make
  shares sum exactly here — that's `resolveSplits`'s job at commit time
  (mode `"shares"`, weights = the rounded per-person paise, remainder to
  payer). This avoids a second, ad-hoc rounding algorithm.
- A row with zero or one participant in `shares`, or a `shares` sum of 0, is
  a warning + skip, not a throw — one bad row must not fail the whole import.

### Server: preview
`POST /api/ledgers/:ledgerId/import/preview` — `requireSession,
requireMember`. Multipart body, one file field. Sniffs parser by extension
(`.xls` → Splid, `.csv` → Splitwise); unrecognized extension → 400. Runs the
parser, returns `ParseResult` as JSON. **No DB writes** — this is read-only
against the uploaded bytes, not the ledger.

### Client: mapping UI
New panel in `LedgerMenu.tsx`'s ⋯ menu ("Import"), same `Sheet` pattern as
the existing panels:
1. File input (`accept=".xls,.csv"`).
2. On select, POST to `/import/preview`, show a summary (row count, date
   range, any warnings) and the source-name mapping table.
3. Per `sourceName`: a `Select` defaulting to a case-insensitive nickname
   match against current members if one exists, else unmapped. Options:
   existing members, plus — only when `me.data?.isOwner` — a "create guest
   named `<sourceName>`" option (editable name, mirrors `AddGuest`'s own
   field). Non-owners can only map to existing members; an unmapped name
   blocks the Import button with an inline message, same as other blocked
   states in this file (`ledger.archiveBlocked` etc.).
4. Confirm sends the **already-parsed** `rows` (from step 2's response,
   held in client state) plus the resolved mapping — no re-upload, no
   server-side session state for the parse.

### Server: commit
`POST /api/ledgers/:ledgerId/import/commit` — `requireSession,
requireMember, rejectArchivedWrites` (same guard `expenses.ts` uses — an
archived ledger is read-only). Body:
```ts
{
  rows: ParsedImportRow[];              // echoed back from preview, re-validated server-side
  mapping: Record<string, string>;      // sourceName -> existing memberId
  newGuests: Record<string, string>;    // sourceName -> guest display name (only if isOwner)
}
```
- If `newGuests` is non-empty and `!c.var.user.isOwner`, `403`.
- Re-validate every `sourceName` in `rows` resolves via `mapping` or
  `newGuests` — an unmapped name is a `400`, not a silent drop.
- Currency/shape validation already happened at preview; commit re-checks
  paise bounds (`MAX_PAISE`) and non-zero totals the same way
  `createExpenseSchema` does, since the client payload is not trusted.
- Create new guests first (same insert `AddGuest`/`ledgers.ts:262` uses),
  building `sourceName -> memberId` from mapping ∪ new guests.
- For each row: resolve `payerIndex` from the mapped payer, call
  `resolveSplits({ total: amountPaise, mode: "shares", participantCount,
  payerIndex, values: shares.map(mappedSharePaise) })` — identical function
  `expenses.ts` already uses, so rounding/remainder behavior matches every
  other expense in the app.
- One `db.batch([...])` for all guest inserts + all expense/split inserts —
  atomic, matching the pattern `db/index.ts` already documents for D1's lack
  of cross-request transactions.
- `categoryId: null` on every imported expense (no source category data).
  `notes`: the uploaded filename, e.g. `"Imported from Summary 10 gpa
  gang.xls"` — traceability without a new schema column.
- Response: `{ created: number, skipped: number }` (skipped = warnings from
  preview that the user chose to import anyway).

### New i18n keys
`ledger.menu.import`, `import.fileLabel`, `import.mapping`,
`import.mapUnmapped`, `import.createGuest`, `import.confirm`,
`import.warnings`, `import.done`, `import.failed`.

## Testing
- `resolveSplits` already covers the `"shares"` mode — no new coverage
  needed there.
- New: `parseSplidXls`/`parseSplitwiseCsv` unit tests against small
  fixture buffers/strings (not the real downloaded file — that stays out of
  the repo per instruction). Cover: happy path, non-INR row skipped, footer
  row skipped, garbled/missing date falls back correctly (Splid only).
- New: `import.test.ts` for preview (parses, no writes) and commit
  (non-owner + newGuests → 403; unmapped name → 400; happy path creates
  guests + expenses in one batch; archived ledger → 409).
- New: `insights.test.ts` additions or a new `ledgerInsights.test.ts` for
  the `byMember` shape (paid vs share, member with only a share and no
  paid expense still appears with `paid: 0`).

## Non-goals (explicit, YAGNI)
- Splid's second sheet ("Suggested payments" — precomputed settle-up debts)
  is not imported. The imported expenses already let this app derive its
  own settle-up suggestions.
- No dedup/idempotency check on repeated imports of the same file — user
  reviews the preview before confirming; that's the guard.
- No date-range filter on per-ledger insights.
- No support for importing into a brand-new ledger in one step (import
  always targets the current ledger, from its ⋯ menu).

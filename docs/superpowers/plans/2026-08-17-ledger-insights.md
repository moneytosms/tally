# Per-Ledger Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-ledger insights view (category/month breakdown + who-paid/who-owes pie charts) reachable from the ledger's Activity/Recurring link row.

**Architecture:** One new server route (`GET /api/ledgers/:ledgerId/insights`) that walks the ledger's own expenses/members (no per-viewer filtering, unlike the existing lifetime `/api/insights`). One new client route + query hook, reusing the existing lazy-recharts bar chart components and adding a lazy Pie chart.

**Tech Stack:** Hono (server), React + TanStack Query + react-router (client), recharts (lazy-loaded, already a dependency).

**Spec:** `docs/superpowers/specs/2026-08-17-ledger-insights-and-import-design.md` (section A)

## Global Constraints

- Money is integer paise everywhere — no float in storage, API, or calculation (ADR 0003).
- Never render a bare amount — sign and label always, via the existing `Amount` component; colour is never the only cue.
- Balances/aggregates here are derived on every request, never cached server-side.
- Every user-facing string goes through `t()` — add new keys to `locales/en.json`, don't inline English.
- Follow existing patterns exactly: `src/server/routes/insights.ts` for the aggregation shape, `src/client/routes/InsightsTab.tsx` for the chart/section layout.

---

### Task 1: Server route `GET /ledgers/:ledgerId/insights`

**Files:**
- Modify: `src/server/routes/insights.ts`
- Test: `src/server/routes/insights.test.ts`

**Interfaces:**
- Consumes: `db.listExpenses(ledgerId)` (returns `StoredExpense[]` with `.splits`, already filters soft-deletes), `db.listMembers(ledgerId)`, `db.listCategories()` — all already used elsewhere in this file's sibling routes.
- Produces (for Task 3/4 to consume as the wire type):
```ts
type LedgerInsights = {
  totals: { spent: number; expenseCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: number; count: number }>;
  byMonth: Array<{ month: string; spent: number }>;
  byMember: Array<{ memberId: string; nickname: string; paid: number; share: number }>;
};
```

- [ ] **Step 1: Write the failing test**

Add to `src/server/routes/insights.test.ts`, below the existing `describe("GET /insights", ...)` block (same file, same imports — `expensesRouter`/`insightsRouter`/`h`/`app` are already set up in `beforeEach`):

```ts
type LedgerInsights = {
  totals: { spent: number; expenseCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: number; count: number }>;
  byMonth: Array<{ month: string; spent: number }>;
  byMember: Array<{ memberId: string; nickname: string; paid: number; share: number }>;
};

const ledgerInsights = async (ledgerId: string) =>
  (await (await app.request(req(h, `/api/ledgers/${ledgerId}/insights`))).json()) as LedgerInsights;

describe("GET /ledgers/:ledgerId/insights", () => {
  it("sums the WHOLE ledger's spend, not just the caller's share", async () => {
    // ₹100.00 total, split evenly between Bob and the guest - Ada (the caller) is not a participant.
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", participants: [{ memberId: "m_bob" }, { memberId: "m_guest" }] });

    const i = await ledgerInsights("L1");
    expect(i.totals.spent).toBe(10_000); // whole ledger, not Ada's (zero) share
    expect(i.totals.expenseCount).toBe(1);
  });

  it("reports byMember paid vs share separately, including a member with only a share", async () => {
    // Bob pays ₹80.00, split evenly between Ada and Bob (₹40.00 each).
    await expense("L1", { total: 8_000, payerMemberId: "m_bob", participants: [{ memberId: "m_ada" }, { memberId: "m_bob" }] });

    const i = await ledgerInsights("L1");
    const ada = i.byMember.find((m) => m.memberId === "m_ada")!;
    const bob = i.byMember.find((m) => m.memberId === "m_bob")!;
    expect(ada).toMatchObject({ paid: 0, share: 4_000 });
    expect(bob).toMatchObject({ paid: 8_000, share: 4_000 });
  });

  it("orders byCategory by spent descending, using the expense total (not a per-viewer share)", async () => {
    await expense("L1", { total: 10_000, payerMemberId: "m_bob", categoryId: "cat_food", participants: [{ memberId: "m_bob" }, { memberId: "m_guest" }] });
    await expense("L1", { total: 20_000, payerMemberId: "m_bob", categoryId: "cat_transport", participants: [{ memberId: "m_bob" }, { memberId: "m_guest" }] });

    const i = await ledgerInsights("L1");
    expect(i.byCategory.map((c) => c.categoryId)).toEqual(["cat_transport", "cat_food"]);
    expect(i.byCategory.find((c) => c.categoryId === "cat_food")).toMatchObject({ spent: 10_000, count: 1 });
  });

  it("fills a gap month with 0, ascending, scoped to this ledger only", async () => {
    const jan = Date.UTC(2026, 0, 15);
    const mar = Date.UTC(2026, 2, 15);
    await expense("L1", { total: 2_000, paidAtEpochMs: jan, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] });
    await expense("L1", { total: 4_000, paidAtEpochMs: mar, payerMemberId: "m_ada", participants: [{ memberId: "m_ada" }] });

    const i = await ledgerInsights("L1");
    expect(i.byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(i.byMonth.map((m) => m.spent)).toEqual([2_000, 0, 4_000]);
  });

  it("404s are not a concern here - a non-member gets rejected by requireMember", async () => {
    const res = await app.request(req(h, "/api/ledgers/L2/insights")); // Ada is not a member of L2... wait Ada IS n_ada on L2
    // Ada is on both L1 and L2 in the harness, so use a ledger id that doesn't exist instead.
    const res2 = await app.request(req(h, "/api/ledgers/does-not-exist/insights"));
    expect(res2.status).toBe(403);
    void res;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test insights.test.ts`
Expected: FAIL — `GET /ledgers/:ledgerId/insights` returns 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

In `src/server/routes/insights.ts`, the file currently only has `insights.get("/insights", ...)`. Add `requireMember` to the imports and a new route. Replace the top of the file (imports) and append the new route before `export default insights;`:

```ts
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
```

Append before `export default insights;`:

```ts
/** Ledger-scoped insights: the WHOLE ledger's numbers, not filtered to the
 *  caller's own shares - this answers "what happened in this trip", not
 *  "what did I spend". Unlike the lifetime endpoint above, this one walks
 *  `listExpenses` directly since every expense in the ledger is in scope. */
insights.get("/ledgers/:ledgerId/insights", requireSession, requireMember, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const [expenses, members, categories] = await Promise.all([
    db.listExpenses(ledgerId),
    db.listMembers(ledgerId),
    db.listCategories(),
  ]);
  const categoryById = new Map(categories.map((cat) => [cat.id, cat]));
  const nameOfMember = new Map(members.map((m) => [m.id, m.nickname ?? m.guestName ?? ""]));

  let spent = 0;
  const byCategory = new Map<string | null, { spent: number; count: number }>();
  const byMonth = new Map<string, number>();
  const paidByMember = new Map<string, number>();
  const shareByMember = new Map<string, number>();

  for (const e of expenses) {
    spent += e.total;

    const cat = byCategory.get(e.categoryId) ?? { spent: 0, count: 0 };
    cat.spent += e.total;
    cat.count += 1;
    byCategory.set(e.categoryId, cat);

    const mk = monthKey(e.paidAt);
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + e.total);

    paidByMember.set(e.payerMemberId, (paidByMember.get(e.payerMemberId) ?? 0) + e.total);
    for (const s of e.splits) {
      shareByMember.set(s.memberId, (shareByMember.get(s.memberId) ?? 0) + s.amount);
    }
  }

  const byCategoryOut = [...byCategory]
    .map(([categoryId, v]) => {
      const cat = categoryId ? categoryById.get(categoryId) : undefined;
      return { categoryId, name: cat?.name ?? "Uncategorised", icon: cat?.icon ?? null, spent: v.spent, count: v.count };
    })
    .sort((a, b) => b.spent - a.spent);

  const months = [...byMonth.keys()].sort();
  const byMonthOut =
    months.length === 0
      ? []
      : fillMonths(months[0]!, months[months.length - 1]!).map((month) => ({ month, spent: byMonth.get(month) ?? 0 }));

  // Every current member appears, even one with only a paid entry or only a
  // share entry - a zero on the side they didn't touch is the correct number,
  // not an absence.
  const memberIds = new Set([...members.map((m) => m.id), ...paidByMember.keys(), ...shareByMember.keys()]);
  const byMember = [...memberIds]
    .map((memberId) => ({
      memberId,
      nickname: nameOfMember.get(memberId) ?? "",
      paid: paidByMember.get(memberId) ?? 0,
      share: shareByMember.get(memberId) ?? 0,
    }))
    .sort((a, b) => b.share - a.share);

  return c.json({
    totals: { spent, expenseCount: expenses.length },
    byCategory: byCategoryOut,
    byMonth: byMonthOut,
    byMember,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test insights.test.ts`
Expected: PASS, all new tests green, existing `GET /insights` tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/insights.ts src/server/routes/insights.test.ts
git commit -m "feat(insights): add per-ledger insights endpoint"
```

---

### Task 2: Client query hook + wire type

**Files:**
- Modify: `src/client/lib/queries.ts`

**Interfaces:**
- Consumes: `LedgerInsights` server shape from Task 1 (exact field names above).
- Produces: `LedgerInsights` type export, `qk.ledgerInsights(ledgerId)`, `useLedgerInsights(ledgerId)` — for Task 3 to import.

- [ ] **Step 1: Add the type**

In `src/client/lib/queries.ts`, right after the existing `Insights` type (near line 116), add:

```ts
export type LedgerInsights = {
  totals: { spent: Paise; expenseCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: Paise; count: number }>;
  byMonth: Array<{ month: string; spent: Paise }>;
  byMember: Array<{ memberId: string; nickname: string; paid: Paise; share: Paise }>;
};
```

- [ ] **Step 2: Add the query key**

In the `qk` object (near line 201, right after `insights: (from, to) => ...`), add:

```ts
  ledgerInsights: (ledgerId: string) => ["ledgers", ledgerId, "insights"] as const,
```

- [ ] **Step 3: Add the hook**

Right after `useInsights` (near line 282), add:

```ts
export const useLedgerInsights = (ledgerId: string) =>
  useQuery({
    queryKey: qk.ledgerInsights(ledgerId),
    queryFn: () => api<LedgerInsights>(`/api/ledgers/${ledgerId}/insights`),
  });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors (this task adds no consumers yet, so nothing can be wrong beyond a syntax slip).

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/queries.ts
git commit -m "feat(insights): add useLedgerInsights query hook"
```

---

### Task 3: Extract shared chart components from InsightsTab

**Files:**
- Modify: `src/client/routes/InsightsTab.tsx`
- Create: `src/client/components/charts.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CategoryChart`, `MonthChart`, `ChartFallback`, `CHART_COLORS`, `SectionHeading` — exported from `charts.tsx` for Task 4 (`LedgerInsights.tsx`) to import alongside a new `MemberPieChart`.

Why this task exists: `InsightsTab.tsx` currently defines `CategoryChart`/`MonthChart`/`ChartFallback`/`SectionHeading`/`CHART_COLORS` as private to that file. The new ledger insights page needs the same bar charts. Moving them once now avoids a second copy — the spec calls this out explicitly ("export them ... so both tabs pull from one `import("recharts")` chunk, not two").

- [ ] **Step 1: Create the shared module**

Create `src/client/components/charts.tsx`:

```tsx
import { lazy } from "react";
import { t } from "~/client/i18n";

const reduceMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

// Earth tones from tokens.css, cycled per category/bar/member - colour is
// decoration here, never the only cue (a list next to each chart carries the
// real data).
export const CHART_COLORS = ["var(--moss)", "var(--ochre)", "var(--clay)", "var(--moss-2)"];

export type CategoryDatum = { categoryId: string | null; name: string; icon: string | null; spent: number; count: number };
export type MonthDatum = { month: string; spent: number };

// One `import("recharts")` module id shared by every lazy() call site in this
// module, so Rollup emits a single extra chunk regardless of how many charts
// pull from it - opening any insights page is what fetches it, nothing else does.
export const CategoryChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: CategoryDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
        <m.BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <m.XAxis type="number" hide />
          <m.YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
          <m.Bar dataKey="spent" isAnimationActive={!reduceMotion} radius={3}>
            {data.map((_, i) => (
              <m.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </m.Bar>
        </m.BarChart>
      </m.ResponsiveContainer>
    ),
  })),
);

/** "2026-08" is a database value, not a label. */
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });
export const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y !== undefined && m !== undefined && Number.isFinite(y) && Number.isFinite(m)
    ? monthFormat.format(new Date(y, m - 1, 1))
    : iso;
};

export const MonthChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: MonthDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={180}>
        <m.BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <m.XAxis
            dataKey="month"
            tickFormatter={monthLabel}
            tick={{ fontSize: 10, fill: "var(--ink-3)" }}
            axisLine={false}
            tickLine={false}
          />
          <m.YAxis hide />
          <m.Bar dataKey="spent" fill="var(--moss)" isAnimationActive={!reduceMotion} radius={3} />
        </m.BarChart>
      </m.ResponsiveContainer>
    ),
  })),
);

export type PieDatum = { name: string; value: number };

/** A single labelled pie, used twice on the ledger insights page (paid /
 *  share) with two different datasets - the caller picks which numbers go in. */
export const MemberPieChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: PieDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={200}>
        <m.PieChart>
          <m.Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} isAnimationActive={!reduceMotion}>
            {data.map((_, i) => (
              <m.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </m.Pie>
        </m.PieChart>
      </m.ResponsiveContainer>
    ),
  })),
);

export function ChartFallback({ height }: { height: number }) {
  return (
    <div className="grid place-items-center text-[12px]" style={{ height, color: "var(--ink-3)" }}>
      {t("insights.chartLoading")}
    </div>
  );
}

export function SectionHeading({ children }: { children: string }) {
  return (
    <div className="mx-0.5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Update InsightsTab.tsx to import from the shared module**

In `src/client/routes/InsightsTab.tsx`, replace lines 1-95 (everything from the top imports through the closing of the old `SectionHeading` function, i.e. up to but not including `function InsightsBody`) with:

```tsx
import { Suspense, useMemo, useState } from "react";
import { Amount, Avatar, EmptyState } from "~/client/components/ui";
import { CategoryChart, ChartFallback, MonthChart, SectionHeading } from "~/client/components/charts";
import { useInsights, type Insights } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const DAY = 86_400_000;

type Range = "all" | "12m" | "30d" | "custom";

/** "YYYY-MM-DD" inputs -> inclusive [from, to] epoch bounds, local calendar
 *  days. `null` when either input is empty/unparseable or the end date is
 *  before the start date - callers treat that as "not ready to filter yet",
 *  not as an error to throw. */
export function parseCustomRange(fromInput: string, toInput: string): { from: number; to: number } | null {
  if (!fromInput || !toInput) return null;
  const from = new Date(`${fromInput}T00:00:00`).getTime();
  const to = new Date(`${toInput}T23:59:59.999`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return { from, to };
}
```

(This drops the file-local `lazy`, `CHART_COLORS`, `reduceMotion`, `CategoryChart`, `monthFormat`, `monthLabel`, `MonthChart`, `ChartFallback`, `SectionHeading` definitions — they now come from `~/client/components/charts`. Everything from `function InsightsBody` onward in the original file is unchanged.)

- [ ] **Step 3: Typecheck and run existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: no errors; any existing `InsightsTab`-adjacent tests still pass (they test `parseCustomRange`, which is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/client/components/charts.tsx src/client/routes/InsightsTab.tsx
git commit -m "refactor(insights): extract shared chart components for reuse"
```

---

### Task 4: LedgerInsights route + nav link

**Files:**
- Create: `src/client/routes/LedgerInsights.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/routes/LedgerDetail.tsx`
- Modify: `locales/en.json`

**Interfaces:**
- Consumes: `useLedgerInsights` (Task 2), `CategoryChart`/`MonthChart`/`MemberPieChart`/`ChartFallback`/`SectionHeading`/`CHART_COLORS` (Task 3).
- Produces: nothing further consumed by other tasks — this is the leaf.

- [ ] **Step 1: Add i18n keys**

In `locales/en.json`, inside the existing `"insights"` object, add three keys (after `"mostSpentWith": "Most spent with",`):

```json
    "ledgerTitle": "Ledger insights",
    "byMember": "By member",
    "paid": "Paid",
    "share": "Share"
```

Inside the existing `"ledger"."menu"` object, add:

```json
    "insights": "Insights"
```

- [ ] **Step 2: Write the component**

Create `src/client/routes/LedgerInsights.tsx`:

```tsx
import { Suspense } from "react";
import { Link, useParams } from "react-router";
import { Amount, EmptyState } from "~/client/components/ui";
import { CategoryChart, ChartFallback, MemberPieChart, MonthChart, SectionHeading, type PieDatum } from "~/client/components/charts";
import { useLedgerInsights, useLedger, type LedgerInsights } from "~/client/lib/queries";
import { focusRing } from "~/client/components/ui/focus";
import { t } from "~/client/i18n";

function MemberPieSection({ title, data }: { title: string; data: PieDatum[] }) {
  const nonZero = data.filter((d) => d.value > 0);
  return (
    <section className="mb-5">
      <SectionHeading>{title}</SectionHeading>
      <div className="rounded-[7px] border px-3.5 py-3" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        {nonZero.length > 1 && (
          <Suspense fallback={<ChartFallback height={200} />}>
            <MemberPieChart data={nonZero} />
          </Suspense>
        )}
        <ul className="mt-2">
          {nonZero.map((d) => (
            <li key={d.name} className="flex items-center justify-between gap-2.5 py-1">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{d.name}</span>
              <Amount paise={d.value} tone="neutral" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Body({ data }: { data: LedgerInsights }) {
  const paidData: PieDatum[] = data.byMember.map((m) => ({ name: m.nickname, value: m.paid }));
  const shareData: PieDatum[] = data.byMember.map((m) => ({ name: m.nickname, value: m.share }));

  return (
    <>
      <div className="mb-4 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <Amount paise={data.totals.spent} label={t("insights.title")} tone="neutral" hero />
        <div className="mt-3 border-t pt-2.5 text-[11.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
          {t("insights.expenseCount", { count: data.totals.expenseCount })}
        </div>
      </div>

      {data.byCategory.length > 0 && (
        <section className="mb-5">
          <SectionHeading>{t("insights.byCategory")}</SectionHeading>
          <div className="rounded-[7px] border px-3.5 py-3" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
            {data.byCategory.length > 1 && (
              <Suspense fallback={<ChartFallback height={Math.max(120, data.byCategory.length * 32)} />}>
                <CategoryChart data={data.byCategory} />
              </Suspense>
            )}
            <ul className="mt-2">
              {data.byCategory.map((c) => (
                <li key={c.categoryId ?? "none"} className="flex items-center justify-between gap-2.5 py-1">
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">
                    {c.icon && <span aria-hidden="true">{c.icon} </span>}
                    {c.name}
                  </span>
                  <Amount paise={c.spent} label={t("insights.expenseCount", { count: c.count })} tone="neutral" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {data.byMonth.length > 1 && (
        <section className="mb-5">
          <SectionHeading>{t("insights.byMonth")}</SectionHeading>
          <div className="rounded-[7px] border px-3.5 py-3" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
            <Suspense fallback={<ChartFallback height={180} />}>
              <MonthChart data={data.byMonth} />
            </Suspense>
          </div>
        </section>
      )}

      <MemberPieSection title={t("insights.paid")} data={paidData} />
      <MemberPieSection title={t("insights.share")} data={shareData} />
    </>
  );
}

export function LedgerInsights() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const insights = useLedgerInsights(ledgerId);

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link to={`/ledgers/${ledgerId}`} aria-label={t("action.back")} className={`grid min-h-11 min-w-11 place-items-center text-[17px] ${focusRing}`} style={{ color: "var(--ink-3)" }}>
          ←
        </Link>
        <h1 className="serif truncate text-[21px] tracking-[-0.01em]">
          {ledger.data ? `${ledger.data.name} · ${t("insights.ledgerTitle")}` : t("insights.ledgerTitle")}
        </h1>
      </header>

      {insights.isPending ? null : insights.error ? (
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      ) : insights.data.totals.expenseCount === 0 ? (
        <EmptyState title={t("empty.insights")} body={t("empty.insightsBody")} />
      ) : (
        <Body data={insights.data} />
      )}
    </>
  );
}

export default LedgerInsights;
```

- [ ] **Step 3: Wire the route**

In `src/client/App.tsx`, next to the existing `const RecurringTab = lazy(...)` (line 29), add:

```ts
const LedgerInsights = lazy(() => import("./routes/LedgerInsights"));
```

Next to `<Route path="ledgers/:ledgerId/recurring" element={<RecurringTab />} />` (line 153), add:

```tsx
          <Route path="ledgers/:ledgerId/insights" element={<LedgerInsights />} />
```

Update the `FAB_HIDDEN` regex (line 85) to also hide the FAB on this route — it currently reads:
```ts
const FAB_HIDDEN = /\/(settle|activity|recurring)$|^\/you|^\/ledgers\/[^/]+$/;
```
change to:
```ts
const FAB_HIDDEN = /\/(settle|activity|recurring|insights)$|^\/you|^\/ledgers\/[^/]+$/;
```

- [ ] **Step 4: Add the nav link**

In `src/client/routes/LedgerDetail.tsx`, in the link row that already has Activity and Recurring links (the `<span className="flex items-center gap-3">` block), add a third `Link` alongside them:

```tsx
          <Link
            to={`/ledgers/${ledgerId}/insights`}
            className={`min-h-11 px-1 text-[12px] underline ${focusRing}`}
            style={{ color: "var(--moss)" }}
          >
            {t("ledger.menu.insights")}
          </Link>
```
(Place it as the first link in that row, before the Activity link, matching the reading order "Insights, Activity, Recurring".)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, open a ledger with at least two expenses across two categories/months and two different payers, click the new "Insights" link, confirm:
- Category and month bars render.
- Two pie charts ("Paid", "Share") render with a list of members and amounts under each.
- A ledger with zero expenses shows the empty state, not a crash.

- [ ] **Step 7: Commit**

```bash
git add src/client/routes/LedgerInsights.tsx src/client/App.tsx src/client/routes/LedgerDetail.tsx locales/en.json
git commit -m "feat(insights): add per-ledger insights page with member pie charts"
```

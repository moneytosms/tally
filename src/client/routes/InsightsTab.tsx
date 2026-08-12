import { lazy, Suspense, useMemo, useState } from "react";
import { Amount, Avatar, EmptyState } from "~/client/components/ui";
import { useInsights, type Insights } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const DAY = 86_400_000;

const reduceMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

// Earth tones from tokens.css, cycled per category/bar - colour is decoration
// here, never the only cue (the lists next to each chart carry the real data).
const CHART_COLORS = ["var(--moss)", "var(--ochre)", "var(--clay)", "var(--moss-2)"];

type Range = "all" | "12m" | "30d";

// Both charts share one `import("recharts")` module id, so Rollup emits a
// single extra chunk regardless of how many lazy() call sites reference it -
// opening this tab is what pulls it in, nothing else does.
const CategoryChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: Insights["byCategory"] }) => (
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
const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y !== undefined && m !== undefined && Number.isFinite(y) && Number.isFinite(m)
    ? monthFormat.format(new Date(y, m - 1, 1))
    : iso;
};

const MonthChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: Insights["byMonth"] }) => (
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

function ChartFallback({ height }: { height: number }) {
  return (
    <div className="grid place-items-center text-[12px]" style={{ height, color: "var(--ink-3)" }}>
      {t("insights.chartLoading")}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="mx-0.5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}

function InsightsBody({ data }: { data: Insights }) {
  return (
    <>
      <div className="mb-4 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <div className="flex flex-wrap gap-5">
          <Amount paise={data.totals.spent} label={t("insights.youSpent")} tone="neutral" hero />
          <Amount paise={data.totals.paid} label={t("insights.youPaid")} tone="neutral" hero />
        </div>
        <div className="mt-3 border-t pt-2.5 text-[11.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
          {t("insights.expenseCount", { count: data.totals.expenseCount })}
          {" · "}
          {t("insights.ledgerCount", { count: data.totals.ledgerCount })}
        </div>
      </div>

      <section className="mb-5">
        <SectionHeading>{t("insights.byCategory")}</SectionHeading>
        <div className="rounded-[7px] border px-3.5 py-3" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
          {/* One bar is a rectangle, not a comparison. The list below carries the
              same numbers, so the chart only earns its space once there's a shape. */}
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

      <section className="mb-2">
        <SectionHeading>{t("insights.mostSpentWith")}</SectionHeading>
        {data.mostSpentWith.map((p) => (
          <div
            key={p.userId}
            className="mb-2 flex items-center justify-between gap-2.5 rounded-[7px] border px-3.5 py-3"
            style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={p.displayName} />
              <div className="min-w-0">
                <div className="truncate text-[14.5px]">{p.displayName}</div>
                <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {t("insights.sharedExpenses", { count: p.sharedExpenseCount })}
                </div>
              </div>
            </div>
            <Amount paise={p.sharedTotal} label={t("ledger.spent")} tone="neutral" />
          </div>
        ))}
      </section>
    </>
  );
}

export function InsightsTab() {
  const [range, setRange] = useState<Range>("all");
  const from = useMemo(() => {
    const now = Date.now();
    if (range === "12m") return now - 365 * DAY;
    if (range === "30d") return now - 30 * DAY;
    return null;
  }, [range]);
  const insights = useInsights(from);

  return (
    <>
      <header className="mb-3">
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("tabs.insights")}</h1>
      </header>

      <div className="mb-4 flex gap-2">
        {(
          [
            ["all", "insights.rangeAll"],
            ["12m", "insights.range12m"],
            ["30d", "insights.range30d"],
          ] as const
        ).map(([r, key]) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className="min-h-11 flex-1 rounded-[6px] border px-2 text-[13px]"
            style={{
              borderColor: range === r ? "var(--moss)" : "var(--line)",
              background: range === r ? "var(--moss-wash)" : "var(--paper-2)",
              color: range === r ? "var(--moss-2)" : "var(--ink-2)",
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {insights.isPending ? null : insights.error ? (
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      ) : insights.data.totals.expenseCount === 0 ? (
        <EmptyState title={t("empty.insights")} body={t("empty.insightsBody")} />
      ) : (
        <InsightsBody data={insights.data} />
      )}
    </>
  );
}

export default InsightsTab;

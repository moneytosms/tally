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
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const customBounds = useMemo(() => parseCustomRange(customFrom, customTo), [customFrom, customTo]);
  const customInvalid = range === "custom" && customFrom !== "" && customTo !== "" && customBounds === null;

  const { from, to } = useMemo(() => {
    const now = Date.now();
    if (range === "12m") return { from: now - 365 * DAY, to: null };
    if (range === "30d") return { from: now - 30 * DAY, to: null };
    if (range === "custom") return customBounds ?? { from: null, to: null };
    return { from: null, to: null };
  }, [range, customBounds]);
  const insights = useInsights(from, to);

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
            ["custom", "insights.rangeCustom"],
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

      {range === "custom" && (
        <div className="mb-4">
          <div className="flex gap-2">
            <label className="flex-1 text-[13px]">
              <span className="mb-1 block" style={{ color: "var(--ink-3)" }}>
                {t("insights.customFrom")}
              </span>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="min-h-11 w-full rounded-[6px] border px-2 text-[13px]"
                style={{ borderColor: "var(--line)", background: "var(--paper-2)", color: "var(--ink-2)" }}
              />
            </label>
            <label className="flex-1 text-[13px]">
              <span className="mb-1 block" style={{ color: "var(--ink-3)" }}>
                {t("insights.customTo")}
              </span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="min-h-11 w-full rounded-[6px] border px-2 text-[13px]"
                style={{ borderColor: "var(--line)", background: "var(--paper-2)", color: "var(--ink-2)" }}
              />
            </label>
          </div>
          {customInvalid && (
            <p className="mt-1.5 text-[12px]" style={{ color: "var(--clay)" }}>
              {t("insights.invalidRange")}
            </p>
          )}
        </div>
      )}

      {range === "custom" && !customBounds ? null : insights.isPending ? null : insights.error ? (
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

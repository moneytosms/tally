import { Suspense, useMemo, useState } from "react";
import {
  Amount,
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  ScreenSkeleton,
  SectionHeading,
  Segmented,
} from "~/client/components/ui";
import { CategoryChart, ChartFallback, MonthChart } from "~/client/components/charts";
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
      <Card className="mb-4">
        {/* The one hero amount on this screen. */}
        <Amount paise={data.totals.spent} label={t("insights.youSpent")} tone="neutral" hero />
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <Amount paise={data.totals.paid} label={t("insights.youPaid")} tone="neutral" />
          <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("insightsTab.totalsLine", {
              expenses: t("insights.expenseCount", { count: data.totals.expenseCount }),
              ledgers: t("insights.ledgerCount", { count: data.totals.ledgerCount }),
            })}
          </span>
        </div>
      </Card>

      <section>
        <SectionHeading>{t("insights.byCategory")}</SectionHeading>
        <Card>
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
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {c.icon && <span aria-hidden="true">{c.icon} </span>}
                  {c.name}
                </span>
                <Amount paise={c.spent} label={t("insights.expenseCount", { count: c.count })} tone="neutral" />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {data.byMonth.length > 1 && (
        <section>
          <SectionHeading>{t("insights.byMonth")}</SectionHeading>
          <Card>
            <Suspense fallback={<ChartFallback height={180} />}>
              <MonthChart data={data.byMonth} />
            </Suspense>
          </Card>
        </section>
      )}

      <section>
        <SectionHeading>{t("insights.mostSpentWith")}</SectionHeading>
        <ul className="flex flex-col gap-2">
          {data.mostSpentWith.map((p) => (
            <Card as="li" key={p.userId} className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={p.displayName} />
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{p.displayName}</div>
                  <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                    {t("insights.sharedExpenses", { count: p.sharedExpenseCount })}
                  </div>
                </div>
              </div>
              <Amount paise={p.sharedTotal} label={t("ledger.spent")} tone="neutral" />
            </Card>
          ))}
        </ul>
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
      <PageHeader title={t("tabs.insights")} />

      <div className="mb-4">
        <Segmented<Range>
          label={t("insights.rangeLabel")}
          value={range}
          onChange={setRange}
          options={[
            { value: "all", label: t("insights.rangeAll") },
            { value: "12m", label: t("insights.range12m") },
            { value: "30d", label: t("insights.range30d") },
            { value: "custom", label: t("insights.rangeCustom") },
          ]}
        />
      </div>

      {range === "custom" && (
        <div className="mb-4">
          <Field label={t("insights.customFrom")}>
            <Input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </Field>
          <Field label={t("insights.customTo")}>
            <Input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </Field>
          {customInvalid && <Notice tone="danger">{t("insights.invalidRange")}</Notice>}
          {!customBounds && !customInvalid && <Notice tone="info">{t("insightsTab.pickBoth")}</Notice>}
        </div>
      )}

      {range === "custom" && !customBounds ? null : insights.isPending ? (
        <ScreenSkeleton />
      ) : insights.error ? (
        <EmptyState
          title={t("error.generic")}
          body={t("error.network")}
          action={
            <Button size="sm" variant="ghost" onClick={() => insights.refetch()}>
              {t("action.retry")}
            </Button>
          }
        />
      ) : insights.data.totals.expenseCount === 0 ? (
        <EmptyState title={t("empty.insights")} body={t("empty.insightsBody")} />
      ) : (
        <InsightsBody data={insights.data} />
      )}
    </>
  );
}

export default InsightsTab;

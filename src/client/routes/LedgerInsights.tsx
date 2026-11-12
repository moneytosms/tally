import { Suspense } from "react";
import { useParams } from "react-router";
import { Amount, Button, Card, EmptyState, ScreenSkeleton, SectionHeading } from "~/client/components/ui";
import { CategoryChart, ChartFallback, MemberPieChart, MonthChart, type PieDatum } from "~/client/components/charts";
import { useLedgerInsights, type LedgerInsights as LedgerInsightsData } from "~/client/lib/queries";
import { t } from "~/client/i18n";

function MemberPieSection({ title, data }: { title: string; data: PieDatum[] }) {
  const nonZero = data.filter((d) => d.value > 0);
  return (
    <section>
      <SectionHeading as="h3">{title}</SectionHeading>
      <Card>
        {nonZero.length > 1 && (
          <Suspense fallback={<ChartFallback height={200} />}>
            <MemberPieChart data={nonZero} />
          </Suspense>
        )}
        <ul className="mt-2">
          {nonZero.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2.5 py-1">
              <span className="min-w-0 flex-1 truncate text-[15px]">{d.name}</span>
              <Amount paise={d.value} label={title} tone="neutral" />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Body({ data }: { data: LedgerInsightsData }) {
  const paidData: PieDatum[] = data.byMember.map((m) => ({ id: m.memberId, name: m.nickname, value: m.paid }));
  const shareData: PieDatum[] = data.byMember.map((m) => ({ id: m.memberId, name: m.nickname, value: m.share }));

  return (
    <>
      <Card className="mb-4">
        {/* The one hero amount on this screen. */}
        <Amount paise={data.totals.spent} label={t("insights.ledgerSpent")} tone="neutral" hero />
        <div className="mt-3 border-t pt-2.5 text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
          {t("insights.expenseCount", { count: data.totals.expenseCount })}
        </div>
      </Card>

      {data.byCategory.length > 0 && (
        <section>
          <SectionHeading>{t("insights.byCategory")}</SectionHeading>
          <Card>
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
      )}

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

      {data.byMember.length > 0 && (
        <>
          <SectionHeading>{t("insights.byMember")}</SectionHeading>
          <MemberPieSection title={t("insights.paid")} data={paidData} />
          <MemberPieSection title={t("insights.share")} data={shareData} />
        </>
      )}
    </>
  );
}

export function LedgerInsights() {
  const { ledgerId = "" } = useParams();
  const insights = useLedgerInsights(ledgerId);

  return (
    <>
      {insights.isPending ? (
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
        <Body data={insights.data} />
      )}
    </>
  );
}

export default LedgerInsights;

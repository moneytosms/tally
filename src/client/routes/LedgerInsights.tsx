import { Suspense } from "react";
import { Link, useParams } from "react-router";
import { Amount, EmptyState } from "~/client/components/ui";
import { CategoryChart, ChartFallback, MemberPieChart, MonthChart, SectionHeading, type PieDatum } from "~/client/components/charts";
import { useLedgerInsights, useLedger, type LedgerInsights as LedgerInsightsData } from "~/client/lib/queries";
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
              <Amount paise={d.value} label={title} tone="neutral" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Body({ data }: { data: LedgerInsightsData }) {
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

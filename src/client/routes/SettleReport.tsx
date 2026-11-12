// Settle report: the settle picture on one page for the browser's "Save as PDF".
// No PDF library - the print CSS in styles/tokens.css does the work.
//
// Every section is expanded (a printout cannot be clicked) and every figure is the
// same server data the Settle tab shows. Offline shows no numbers at all (SPEC §10).
import { Suspense, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Amount, Button, EmptyState, ScreenSkeleton } from "~/client/components/ui";
import { SettleGraph } from "~/client/components/SettleGraph";
import { TrailList, disclosureSummaryClass, fullyExplained } from "~/client/components/WhyTrail";
import { dayFormat } from "~/client/components/ActivityRow";
import { CategoryChart, ChartFallback, MemberPieChart, type PieDatum } from "~/client/components/charts";
import { netSum, reroutedReason, sortPositions } from "~/client/routes/SettleUp";
import {
  useBalances,
  useExpenses,
  useLedger,
  useLedgerInsights,
  useMembers,
  useOnline,
  type Expense,
  type LedgerBalances,
  type LedgerInsights,
  type LedgerSummary,
  type Member,
} from "~/client/lib/queries";
import { t } from "~/client/i18n";

type Edge = LedgerBalances["transfers"][number];

const muted = { color: "var(--ink-3)" };
const line = { borderColor: "var(--line)" };
const th = "border-b px-2 py-1.5 text-left align-bottom text-[12px] font-semibold";
const td = "border-b px-2 py-2 align-top text-[13px]";

export default function SettleReport() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const balances = useBalances(ledgerId);
  const members = useMembers(ledgerId);
  const insights = useLedgerInsights(ledgerId);
  const expenses = useExpenses(ledgerId);
  const online = useOnline();
  const [generated] = useState(() => new Date());

  const [l, b, m, i, e] = [ledger.data, balances.data, members.data, insights.data, expenses.data];
  const loaded = Boolean(l && b && m && i && e);
  const failed = [ledger, balances, members, insights, expenses].some((q) => q.isError);

  let body: ReactNode;
  if (!online) body = <EmptyState title={t("offline.title")} body={t("offline.body")} />;
  else if (failed) body = <EmptyState title={t("error.generic")} body={t("error.network")} />;
  else if (!l || !b || !m || !i || !e) body = <ScreenSkeleton />;
  else body = <Report ledger={l} balances={b} members={m} insights={i} expenses={e} generated={generated} />;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/ledgers/${ledgerId}/settle`}
          className={disclosureSummaryClass}
          style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
        >
          {t("report.back")}
        </Link>
        <div className="flex items-center gap-2.5">
          {online && !loaded && !failed && (
            <span className="text-[13px]" style={muted}>
              {t("report.printWaiting")}
            </span>
          )}
          <Button size="sm" disabled={!online || !loaded} onClick={() => window.print()}>
            {t("settle.export.pdf")}
          </Button>
        </div>
      </div>
      {body}
    </>
  );
}

/** One suggested transfer or direct debt, its trail expanded. A transfer its trail
 *  does not fully explain gets the direct debts around it, as the Settle tab shows. */
function EdgeRow({
  ledgerId,
  edge,
  sentence,
  reason,
  name,
}: {
  ledgerId: string;
  edge: Edge;
  sentence: string;
  reason: { payerOwes: Edge[]; payeeOwed: Edge[] } | null;
  name: (id: string) => string;
}) {
  const others = reason ? [...reason.payerOwes, ...reason.payeeOwed] : [];
  return (
    <li className="print-block border-b py-3 last:border-b-0" style={line}>
      <h3 className="text-[15px] font-medium">{sentence}</h3>
      <Amount paise={edge.amount} label={t("settle.amount")} tone="neutral" className="mt-1" />
      {others.length > 0 && (
        <div className="mt-2 border-t pt-2" style={line}>
          <h4 className="mb-1 text-[13px] font-medium">{t("settle.graph.reroutedHeading")}</h4>
          {others.map((p) => (
            <Amount
              key={`${p.fromMemberId}-${p.toMemberId}`}
              paise={p.amount}
              label={t("settle.owes", { from: name(p.fromMemberId), to: name(p.toMemberId) })}
              tone="neutral"
              className="w-full justify-between"
            />
          ))}
          <p className="mt-1 text-[13px]" style={muted}>
            {t("settle.graph.rerouted", { from: name(edge.fromMemberId), to: name(edge.toMemberId) })}
          </p>
        </div>
      )}
      <h4 className="mt-2 mb-1 text-[13px] font-medium">{t("report.trailHeading")}</h4>
      <TrailList
        ledgerId={ledgerId}
        fromMemberId={edge.fromMemberId}
        toMemberId={edge.toMemberId}
        amount={edge.amount}
        trail={edge.trail ?? []}
      />
    </li>
  );
}

/** A pie and its numbers, only where there is more than one slice - as on the insights page. */
function MemberPie({ title, data }: { title: string; data: PieDatum[] }) {
  const nonZero = data.filter((d) => d.value > 0);
  return (
    <div className="print-block mb-4">
      <h4 className="mb-1 text-[13px] font-medium">{title}</h4>
      {nonZero.length > 1 && (
        <Suspense fallback={<ChartFallback height={200} />}>
          <MemberPieChart data={nonZero} />
        </Suspense>
      )}
    </div>
  );
}

function Report({
  ledger,
  balances,
  members,
  insights,
  expenses,
  generated,
}: {
  ledger: LedgerSummary;
  balances: LedgerBalances;
  members: Member[];
  insights: LedgerInsights;
  expenses: Expense[];
  generated: Date;
}) {
  const { positions, transfers, pairs, settlements, totals } = balances;
  // Server names are authoritative, including for members who have left (as on the Settle tab).
  const name = (id: string) =>
    positions.find((p) => p.memberId === id)?.name || members.find((m) => m.id === id)?.nickname || t("member.unknown");
  const named = sortPositions(positions.map((p) => ({ ...p, name: name(p.memberId) })));
  const graphPositions = named.map((p) => ({ memberId: p.memberId, name: p.name, net: p.net }));
  const idle = members.filter((m) => !positions.some((p) => p.memberId === m.id));
  const sum = netSum(positions);
  const pie = (key: "paid" | "share") =>
    insights.byMember.map((x) => ({ id: x.memberId, name: x.nickname, value: x[key] }));

  return (
    <div className="flex flex-col gap-6">
      <header className="print-block">
        <h1 className="serif text-[26px] leading-tight">{ledger.name}</h1>
        <p className="text-[14px]" style={muted}>
          {t("report.title")} · {t("report.generated", { date: dayFormat.format(generated) })}
        </p>
        <div
          className="mt-3 flex items-end justify-between gap-3 rounded-[7px] border px-3.5 py-3"
          style={{ background: "var(--paper-2)", ...line }}
        >
          <Amount paise={totals.spent} label={t("settle.totalSpent")} tone="neutral" />
          <span className="text-[13px]" style={muted}>
            {t("settle.expenseCount", { count: totals.expenseCount })}
          </span>
        </div>
      </header>

      {totals.expenseCount === 0 ? (
        <EmptyState title={t("empty.insights")} body={t("empty.insightsBody")} />
      ) : (
        <>
          <section className="print-block">
            <h2 className="mb-2 text-[15px] font-semibold">{t("settle.graph.planView")}</h2>
            <SettleGraph positions={graphPositions} edges={transfers} label={t("settle.graph.label")} />
          </section>

          <section className="print-block">
            <h2 className="mb-2 text-[15px] font-semibold">{t("settle.graph.directView")}</h2>
            <SettleGraph positions={graphPositions} edges={pairs} label={t("settle.graph.label")} />
          </section>

          <section className="print-block">
            <h2 className="mb-1 text-[15px] font-semibold">{t("settle.netHeading")}</h2>
            <p className="mb-3 text-[13px]" style={muted}>
              {t("settle.netExplain")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <caption className="mb-2 text-left text-[13px]" style={muted}>
                  {t("report.positionsCaption")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={th} style={line}>
                      {t("report.col.member")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("insights.paid")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("insights.share")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("report.col.sent")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("report.col.received")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("settle.netPosition")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {named.map((p) => (
                    <tr key={p.memberId}>
                      <th scope="row" className={`${td} font-medium`} style={line}>
                        {p.name}
                      </th>
                      <td className={td} style={line}>
                        <Amount paise={p.paid} label={t("insights.paid")} tone="neutral" className="justify-end" />
                      </td>
                      <td className={td} style={line}>
                        <Amount paise={p.share} label={t("insights.share")} tone="neutral" className="justify-end" />
                      </td>
                      <td className={td} style={line}>
                        <Amount
                          paise={p.settledOut}
                          label={t("report.col.sent")}
                          tone="neutral"
                          className="justify-end"
                        />
                      </td>
                      <td className={td} style={line}>
                        <Amount
                          paise={p.settledIn}
                          label={t("report.col.received")}
                          tone="neutral"
                          className="justify-end"
                        />
                      </td>
                      <td className={td} style={line}>
                        <Amount
                          paise={p.net}
                          label={t("settle.netPosition")}
                          tone="position"
                          subject={p.name}
                          className="justify-end"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {idle.map((m) => (
              <p key={m.id} className="mt-2 text-[13px]" style={muted}>
                {t("settle.noActivity", { name: m.nickname })}
              </p>
            ))}
            <div className="mt-3">
              {sum === 0 ? (
                <Amount paise={0} label={t("settle.checkLabel")} tone="neutral" />
              ) : (
                <p className="text-[13px]" style={{ color: "var(--clay)" }}>
                  {t("settle.checkFailed")} <Amount paise={sum} label={t("settle.checkSum")} tone="neutral" />
                </p>
              )}
            </div>
          </section>

          <section className="print-block">
            <h2 className="mb-2 text-[15px] font-semibold">{t("settle.whoHeading")}</h2>
            {transfers.length === 0 ? (
              <EmptyState title={t("settle.allSettled")} />
            ) : (
              <ul>
                {transfers.map((tr) => (
                  <EdgeRow
                    key={`${tr.fromMemberId}-${tr.toMemberId}`}
                    ledgerId={ledger.id}
                    edge={tr}
                    sentence={t("settle.pays", { from: name(tr.fromMemberId), to: name(tr.toMemberId) })}
                    reason={fullyExplained(tr.trail ?? [], tr.amount) ? null : reroutedReason(tr, pairs)}
                    name={name}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="print-block">
            <h2 className="mb-2 text-[15px] font-semibold">{t("settle.pairsSummary")}</h2>
            <p className="mb-2 text-[13px]" style={muted}>
              {t("settle.pairsExplain")}
            </p>
            {pairs.length === 0 ? (
              <EmptyState title={t("settle.allSettled")} />
            ) : (
              <ul>
                {pairs.map((p) => (
                  <EdgeRow
                    key={`${p.fromMemberId}-${p.toMemberId}`}
                    ledgerId={ledger.id}
                    edge={p}
                    sentence={t("settle.owes", { from: name(p.fromMemberId), to: name(p.toMemberId) })}
                    reason={null}
                    name={name}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="print-block">
            <h2 className="mb-3 text-[15px] font-semibold">{t("settle.settlementsHeading")}</h2>
            {settlements.length === 0 ? (
              <p className="text-[13px]" style={muted}>
                {t("settle.noSettlements")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <caption className="sr-only">{t("settle.settlementsHeading")}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th} style={line}>
                        {t("report.col.date")}
                      </th>
                      <th scope="col" className={th} style={line}>
                        {t("report.col.from")}
                      </th>
                      <th scope="col" className={th} style={line}>
                        {t("report.col.to")}
                      </th>
                      <th scope="col" className={`${th} text-right`} style={line}>
                        {t("settle.amount")}
                      </th>
                      <th scope="col" className={th} style={line}>
                        {t("report.col.method")}
                      </th>
                      <th scope="col" className={th} style={line}>
                        {t("report.col.note")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.id}>
                        <td className={td} style={line}>
                          {dayFormat.format(s.declaredAt)}
                        </td>
                        <td className={td} style={line}>
                          {name(s.fromMemberId)}
                        </td>
                        <td className={td} style={line}>
                          {name(s.toMemberId)}
                        </td>
                        <td className={td} style={line}>
                          <Amount paise={s.amount} label={t("settle.amount")} tone="neutral" className="justify-end" />
                        </td>
                        <td className={td} style={line}>
                          {t(`settle.method.${s.method}`)}
                        </td>
                        <td className={td} style={line}>
                          {s.note ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="print-block">
            <h2 className="mb-3 text-[15px] font-semibold">{t("report.spending")}</h2>

            {insights.byCategory.length > 0 && (
              <div className="print-block mb-5">
                <h3 className="mb-1 text-[13px] font-medium">{t("insights.byCategory")}</h3>
                {insights.byCategory.length > 1 && (
                  <Suspense fallback={<ChartFallback height={Math.max(120, insights.byCategory.length * 32)} />}>
                    <CategoryChart data={insights.byCategory} />
                  </Suspense>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] border-collapse">
                    <caption className="sr-only">{t("insights.byCategory")}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={th} style={line}>
                          {t("expense.category")}
                        </th>
                        <th scope="col" className={th} style={line}>
                          {t("report.col.expenses")}
                        </th>
                        <th scope="col" className={`${th} text-right`} style={line}>
                          {t("report.col.spent")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.byCategory.map((c) => (
                        <tr key={c.categoryId ?? "none"}>
                          <th scope="row" className={`${td} font-medium`} style={line}>
                            {c.icon && <span aria-hidden="true">{c.icon} </span>}
                            {c.name}
                          </th>
                          <td className={td} style={line}>
                            {t("insights.expenseCount", { count: c.count })}
                          </td>
                          <td className={td} style={line}>
                            <Amount
                              paise={c.spent}
                              label={t("report.col.spent")}
                              tone="neutral"
                              className="justify-end"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {insights.byMember.length > 0 && (
              <div className="print-block mb-5">
                <h3 className="mb-1 text-[13px] font-medium">{t("insights.byMember")}</h3>
                <MemberPie title={t("insights.paid")} data={pie("paid")} />
                <MemberPie title={t("insights.share")} data={pie("share")} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] border-collapse">
                    <caption className="sr-only">{t("insights.byMember")}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={th} style={line}>
                          {t("report.col.member")}
                        </th>
                        <th scope="col" className={`${th} text-right`} style={line}>
                          {t("insights.paid")}
                        </th>
                        <th scope="col" className={`${th} text-right`} style={line}>
                          {t("insights.share")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.byMember.map((x) => (
                        <tr key={x.memberId}>
                          <th scope="row" className={`${td} font-medium`} style={line}>
                            {x.nickname}
                          </th>
                          <td className={td} style={line}>
                            <Amount paise={x.paid} label={t("insights.paid")} tone="neutral" className="justify-end" />
                          </td>
                          <td className={td} style={line}>
                            <Amount
                              paise={x.share}
                              label={t("insights.share")}
                              tone="neutral"
                              className="justify-end"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="print-block">
            <h2 className="mb-2 text-[15px] font-semibold">{t("report.expenses")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <caption className="mb-2 text-left text-[13px]" style={muted}>
                  {t("report.expensesCaption")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={th} style={line}>
                      {t("report.col.date")}
                    </th>
                    <th scope="col" className={th} style={line}>
                      {t("report.col.description")}
                    </th>
                    <th scope="col" className={th} style={line}>
                      {t("expense.paidBy")}
                    </th>
                    <th scope="col" className={`${th} text-right`} style={line}>
                      {t("report.col.total")}
                    </th>
                    <th scope="col" className={th} style={line}>
                      {t("report.col.shares")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((x) => (
                    <tr key={x.id} className="print-block">
                      <td className={td} style={line}>
                        {dayFormat.format(x.paidAt)}
                      </td>
                      <td className={td} style={line}>
                        {x.description}
                      </td>
                      <td className={td} style={line}>
                        {name(x.payerMemberId)}
                      </td>
                      <td className={td} style={line}>
                        <Amount paise={x.total} label={t("report.col.total")} tone="neutral" className="justify-end" />
                      </td>
                      <td className={td} style={line}>
                        <ul>
                          {x.splits.map((s) => (
                            <li key={s.memberId}>
                              {name(s.memberId)}:{" "}
                              <Amount paise={s.amount} label={t("expense.shareLabel")} tone="neutral" />
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

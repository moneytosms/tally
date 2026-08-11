import { Link } from "react-router";
import { Amount, EmptyState } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useLedgers, type LedgerSummary } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const DAY = 86_400_000;
const daysLeft = (endDate: number) => Math.ceil((endDate - Date.now()) / DAY);

/** Burn rate. Only shown when the ledger has both an end date and a budget —
 *  without both there is nothing to burn against. Integer paise throughout. */
function BurnRate({ ledger }: { ledger: LedgerSummary }) {
  if (ledger.budget === null || ledger.endDate === null) return null;
  const pct = Math.min(100, Math.round((ledger.spent * 100) / ledger.budget));
  const days = daysLeft(ledger.endDate);
  const perDay = days > 0 ? Math.floor(Math.max(0, ledger.budget - ledger.spent) / days) : 0;
  return (
    <div className="mt-2.5">
      <div className="h-1 overflow-hidden rounded-full border" style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}>
        <i className="block h-full" style={{ width: `${pct}%`, background: "var(--moss)", opacity: 0.75 }} />
      </div>
      <div className="mt-1.5 flex gap-3">
        <Amount paise={ledger.spent} label={t("ledger.spent")} tone="neutral" />
        <Amount paise={ledger.budget} label={t("ledger.budget")} tone="neutral" />
        {days > 0 && <Amount paise={perDay} label={t("ledger.perDayLeft")} tone="neutral" />}
      </div>
    </div>
  );
}

function LedgerCard({ ledger }: { ledger: LedgerSummary }) {
  const days = ledger.endDate === null ? null : daysLeft(ledger.endDate);
  return (
    <Link
      to={`/ledgers/${ledger.id}`}
      className={`mb-2 block rounded-[7px] border px-3.5 py-3 ${focusRing}`}
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-medium">{ledger.name}</div>
          <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            {t("expense.member", { count: ledger.memberCount })}
            {" · "}
            {days === null ? t("ledger.standing") : days > 0 ? t("ledger.daysLeft", { count: days }) : t("ledger.ended")}
          </div>
        </div>
        <Amount paise={ledger.net} label={t("ledger.yourPosition")} />
      </div>
      <BurnRate ledger={ledger} />
    </Link>
  );
}

export function LedgersTab() {
  const { data, isPending, error } = useLedgers();

  if (isPending) return null;
  if (error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const active = data.filter((l) => l.archivedAt === null);
  const overall = active.reduce((sum, l) => sum + l.net, 0);

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5">
        <h1 className="serif flex-1 text-[21px] tracking-[-0.01em]">{t("app.name")}</h1>
      </header>

      {active.length === 0 ? (
        <EmptyState title={t("empty.ledgers")} body={t("empty.ledgersBody")} />
      ) : (
        <>
          <div className="mb-4 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
            <Amount paise={overall} label={t("balances.overall")} hero />
            <div className="mt-3 border-t pt-2.5 text-[11.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
              <Link to="/balances" className={`${focusRing} inline-flex min-h-11 items-center`} style={{ color: "var(--moss-2)" }}>
                {t("balances.settleAcross")} →
              </Link>
            </div>
          </div>

          <div className="mx-0.5 mt-1 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
            {t("tabs.ledgers")}
          </div>
          {active.map((ledger) => (
            <LedgerCard key={ledger.id} ledger={ledger} />
          ))}
        </>
      )}
    </>
  );
}

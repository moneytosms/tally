import { useState } from "react";
import { Link } from "react-router";
import { Amount, Button, EmptyState, Skeleton } from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { ActivityRow } from "~/client/components/ActivityRow";
import { LedgerForm, type LedgerKind } from "~/client/components/LedgerForm";
import { useLedgers, useMe, useRecentActivity, type LedgerSummary } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const DAY = 86_400_000;
export const daysLeft = (endDate: number) => Math.ceil((endDate - Date.now()) / DAY);

/** "standing" / "4 days left" / "ended" - the same phrase on the card and in the
 *  ledger's own header, so they cannot drift apart. */
export const runFor = (endDate: number | null) =>
  endDate === null
    ? t("ledger.standing")
    : daysLeft(endDate) > 0
      ? t("ledger.daysLeft", { count: daysLeft(endDate) })
      : t("ledger.ended");

/** Burn rate. Only shown when the ledger has both an end date and a budget -
 *  without both there is nothing to burn against. Integer paise throughout. */
export function BurnRate({ ledger }: { ledger: LedgerSummary }) {
  if (ledger.budget === null || ledger.endDate === null) return null;
  const pct = Math.min(100, Math.round((ledger.spent * 100) / ledger.budget));
  const days = daysLeft(ledger.endDate);
  const perDay = days > 0 ? Math.floor(Math.max(0, ledger.budget - ledger.spent) / days) : 0;
  return (
    <div className="mt-2.5">
      <div className="h-1 overflow-hidden rounded-full border" style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}>
        {/* Over budget is worth seeing, not just capping the bar at full. */}
        <i
          className="block h-full"
          style={{ width: `${pct}%`, background: ledger.spent > ledger.budget ? "var(--clay)" : "var(--moss)", opacity: 0.75 }}
        />
      </div>
      {/* Two columns, not three: at 430px a third column breaks "a day left"
          across three lines and the row stops reading as numbers. */}
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 whitespace-nowrap">
        <Amount paise={ledger.spent} label={t("ledger.spent")} tone="neutral" />
        <Amount paise={ledger.budget} label={t("ledger.budget")} tone="neutral" />
        {days > 0 && <Amount paise={perDay} label={t("ledger.perDayLeft")} tone="neutral" />}
      </div>
    </div>
  );
}

function LedgerCard({ ledger }: { ledger: LedgerSummary }) {
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
            {runFor(ledger.endDate)}
          </div>
        </div>
        <Amount paise={ledger.net} label={t("ledger.yourPosition")} />
      </div>
      <BurnRate ledger={ledger} />
    </Link>
  );
}

/** Small uppercase rule above a block. Used often enough that keeping it here
 *  stops three screens from drifting to three different sizes. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-0.5 mt-1 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}

/** What happened lately, across every ledger. Nothing here is a balance - it is
 *  history, so an empty feed just hides rather than claiming "all settled". */
function RecentActivity() {
  const { data, isPending, error } = useRecentActivity();
  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (error || (data ?? []).length === 0) return null;
  return (
    <section className="mt-5">
      <SectionLabel>{t("home.recent")}</SectionLabel>
      <ul className="rounded-[7px] border px-3.5 py-1" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        {data.map((e) => (
          <ActivityRow key={e.id} event={e} showTime={false} />
        ))}
      </ul>
    </section>
  );
}

export function LedgersTab() {
  const { data, isPending, error } = useLedgers();
  const me = useMe();
  // The empty state is the first thing a new account sees, so it carries its own
  // way out rather than pointing at the FAB and hoping.
  const [kind, setKind] = useState<LedgerKind | null>(null);

  if (isPending)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  if (error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const active = data.filter((l) => l.archivedAt === null);
  const archived = data.filter((l) => l.archivedAt !== null);
  const overall = active.reduce((sum, l) => sum + l.net, 0);
  // Net alone hides the shape of it: being owed 5000 and owing 5000 is not the
  // same situation as owing nothing, and only one of them needs settling.
  const owed = active.reduce((sum, l) => sum + Math.max(0, l.net), 0);
  const owe = active.reduce((sum, l) => sum + Math.min(0, l.net), 0);

  return (
    <>
      <header className="mb-3">
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("app.name")}</h1>
        {me.data && (
          <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {t("home.greeting", { name: me.data.displayName })}
          </p>
        )}
      </header>

      {active.length === 0 ? (
        <EmptyState
          title={t("empty.ledgers")}
          body={t("empty.ledgersBody")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setKind("trip")}>{t("add.trip")}</Button>
              <Button variant="ghost" onClick={() => setKind("group")}>
                {t("add.group")}
              </Button>
              <Button variant="ghost" onClick={() => setKind("pair")}>
                {t("add.pair")}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-4 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
            <Amount paise={overall} label={t("balances.overall")} hero />
            {(owed !== 0 || owe !== 0) && (
              <div className="mt-3 grid grid-cols-2 gap-x-3 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
                <Amount paise={owed} label={t("home.owed")} tone="neutral" />
                <Amount paise={Math.abs(owe)} label={t("home.owe")} tone="neutral" />
              </div>
            )}
            <div className="mt-2.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              <Link to="/balances" className={`${focusRing} inline-flex min-h-11 items-center`} style={{ color: "var(--moss-2)" }}>
                {t("balances.settleAcross")} →
              </Link>
            </div>
          </div>

          <SectionLabel>{t("tabs.ledgers")}</SectionLabel>
          {active.map((ledger) => (
            <LedgerCard key={ledger.id} ledger={ledger} />
          ))}

          <RecentActivity />

          {/* Archived ledgers are settled history: present, but folded away so
              they never compete with the ledgers people are actually spending on. */}
          {archived.length > 0 && (
            <details className="mt-5">
              <summary className={`cursor-pointer text-[12px] ${focusRing}`} style={{ color: "var(--ink-3)" }}>
                {t("home.archived", { count: archived.length })}
              </summary>
              <div className="mt-2">
                {archived.map((ledger) => (
                  <LedgerCard key={ledger.id} ledger={ledger} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <Sheet open={kind !== null} onOpenChange={(o) => !o && setKind(null)} title={kind ? t(`add.${kind}`) : ""}>
        {kind && <LedgerForm kind={kind} onDone={() => setKind(null)} />}
      </Sheet>
    </>
  );
}

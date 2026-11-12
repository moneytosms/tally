// A ledger's shell: header, position, and the sections as tabs. Each section is
// a child route, so the header and position stay put while switching between them.
import { Suspense } from "react";
import { Link, Outlet, useLocation, useMatch, useParams } from "react-router";
import { Amount, EmptyState, focusRing, Icon, PageHeader, ScreenSkeleton, Tabs } from "~/client/components/ui";
import { LedgerMenu } from "~/client/components/LedgerMenu";
import { BurnRate, runFor } from "~/client/routes/LedgersTab";
import { useLedger } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export function LedgerLayout() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const { pathname } = useLocation();
  // The position is shown once, on the Expenses tab. Other tabs would repeat it.
  const onExpenses = useMatch({ path: "/ledgers/:ledgerId", end: true }) !== null;

  // Back stays available while loading or failing, so there is no dead end.
  if (ledger.isPending) {
    return (
      <>
        <PageHeader title={t("app.name")} back="/" />
        <ScreenSkeleton />
      </>
    );
  }
  if (ledger.error) {
    return (
      <>
        <PageHeader title={t("app.name")} back="/" />
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      </>
    );
  }

  const l = ledger.data;

  return (
    <>
      <PageHeader
        title={l.name}
        subtitle={t("ledgerNav.subtitle", {
          members: t("expense.member", { count: l.memberCount }),
          period: runFor(l.endDate),
        })}
        back="/"
        action={<LedgerMenu ledger={l} />}
      />

      {onExpenses && (
        <div
          className="mb-4 rounded-[7px] border px-3.5 py-4"
          style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
        >
          <div className="flex items-end justify-between gap-3">
            <Amount paise={l.net} label={t("ledger.yourPosition")} hero />
            {/* The next step sits beside the number it resolves: one tap from the
                position to how it settles. Filled when the viewer owes, quiet otherwise. */}
            {l.net !== 0 && l.archivedAt === null && (
              <Link
                to={`/ledgers/${ledgerId}/settle`}
                className={`inline-flex min-h-11 flex-none items-center gap-1 rounded-[7px] border pr-2.5 pl-3.5 text-[14px] font-semibold transition-[background-color,transform] duration-150 active:scale-[0.98] ${
                  l.net < 0
                    ? "border-[var(--moss)] bg-[var(--moss)] text-[var(--paper)] hover:bg-[var(--moss-2)]"
                    : "border-[var(--line-2)] text-[var(--ink)] hover:bg-[var(--paper-sunk)]"
                } ${focusRing}`}
              >
                {t("ledgerNav.settle")}
                <Icon name="forward" size={16} />
              </Link>
            )}
          </div>
          {/* A budget entered at creation used to be stored and never shown again. */}
          <BurnRate ledger={l} />
        </div>
      )}

      <div className="mb-4">
        <Tabs
          label={t("ledgerNav.label")}
          items={[
            { to: `/ledgers/${ledgerId}`, label: t("ledgerNav.expenses"), end: true },
            { to: `/ledgers/${ledgerId}/settle`, label: t("ledgerNav.settle") },
            { to: `/ledgers/${ledgerId}/insights`, label: t("ledgerNav.insights") },
            { to: `/ledgers/${ledgerId}/activity`, label: t("ledgerNav.activity") },
          ]}
        />
      </div>

      <Suspense fallback={<ScreenSkeleton />}>
        {/* Only the tab content fades; the header above stays put between tabs. */}
        <div key={pathname} className="page-in">
          <Outlet />
        </div>
      </Suspense>
    </>
  );
}

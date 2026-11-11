import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Amount, Button, EmptyState, PageHeader, Skeleton } from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { ActivityRow } from "~/client/components/ActivityRow";
import { LedgerForm, LEDGER_COLOR_SWATCH, type LedgerKind } from "~/client/components/LedgerForm";
import { useLedgers, useMe, useRecentActivity, useTogglePin, type LedgerSummary } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const DAY = 86_400_000;
const KINDS: LedgerKind[] = ["trip", "group", "pair"];
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
      <div
        className="h-1 overflow-hidden rounded-full border"
        style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
      >
        {/* Over budget is worth seeing, not just capping the bar at full. */}
        <i
          className="block h-full"
          style={{
            width: `${pct}%`,
            background: ledger.spent > ledger.budget ? "var(--clay)" : "var(--moss)",
            opacity: 0.75,
          }}
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

/** Pin toggle (issue #26). A sibling of the card's Link, not a child of it: nested
 *  interactive elements are invalid. Sits over the card's top-right corner. */
function PinButton({ ledger }: { ledger: LedgerSummary }) {
  const togglePin = useTogglePin(ledger.id);
  return (
    <button
      type="button"
      aria-label={t(ledger.pinned ? "ledger.unpin" : "ledger.pin")}
      aria-pressed={ledger.pinned}
      onClick={() => togglePin.mutate(!ledger.pinned)}
      className={`absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-[7px] ${focusRing}`}
      style={{ color: ledger.pinned ? "var(--ochre)" : "var(--ink-3)" }}
    >
      {/* A plain filled/outline star - colour alone is never the only cue, the
          fill state carries it too. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={ledger.pinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2.1 9.8l7.1-.7z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function LedgerCard({ ledger }: { ledger: LedgerSummary }) {
  return (
    <div
      className="row-in relative mb-2 rounded-[7px] border"
      style={{
        background: "var(--paper-2)",
        borderColor: "var(--line)",
        // The cover accent (issue #27) is a left rule, not a fill - it stays
        // legible in every theme without fighting the card's own text colour.
        borderLeft: ledger.color ? `3px solid ${LEDGER_COLOR_SWATCH[ledger.color]}` : undefined,
      }}
    >
      <Link to={`/ledgers/${ledger.id}`} className={`block rounded-[7px] py-3 pr-3.5 pl-3.5 ${focusRing}`}>
        {/* pr-12 keeps the name clear of the pin button in the corner; row 2 is full width. min-h-11 keeps the 44px star off row 2. */}
        <div className="flex min-h-11 items-center gap-1.5 pr-12">
          {ledger.emoji && (
            <span className="shrink-0" aria-hidden="true">
              {ledger.emoji}
            </span>
          )}
          <div className="min-w-0 truncate text-[15px] font-medium">{ledger.name}</div>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2.5">
          <div className="min-w-0 truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("home.ledgerMeta", {
              members: t("expense.member", { count: ledger.memberCount }),
              run: runFor(ledger.endDate),
            })}
          </div>
          <Amount paise={ledger.net} label={t("ledger.yourPosition")} className="shrink-0 whitespace-nowrap" />
        </div>
        <BurnRate ledger={ledger} />
      </Link>
      <PinButton ledger={ledger} />
    </div>
  );
}

/** Section heading, with an optional control on the same row. Used often enough
 *  that keeping it here stops three screens from drifting to three different sizes. */
function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-0.5 mt-1 mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
        {children}
      </h2>
      {action}
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
      <ul
        className="rounded-[7px] border px-3.5 py-1"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
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
  const navigate = useNavigate();
  // "choose" shows the three kinds; a kind shows its form. One sheet for both.
  const [sheet, setSheet] = useState<"choose" | LedgerKind | null>(null);

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
  // The one place a settle-up is the next step. Any ledger where the viewer owes counts.
  const needsSettle = overall < 0 || active.some((l) => l.net < 0);
  // ADR 0008: a restricted account has no self-service way to create a ledger -
  // it waits on the owner to add it to one, or to promote it.
  const restricted = me.data?.accountType === "restricted";

  return (
    <>
      <PageHeader
        title={t("app.name")}
        subtitle={me.data ? t("home.greeting", { name: me.data.displayName }) : undefined}
      />

      {active.length === 0 ? (
        // The empty state is the first thing a new account sees, so it carries its own
        // way out rather than pointing at the FAB and hoping.
        <EmptyState
          title={t("empty.ledgers")}
          body={t("empty.ledgersBody")}
          action={
            restricted ? undefined : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setSheet("trip")}>{t("add.trip")}</Button>
                <Button variant="ghost" onClick={() => setSheet("group")}>
                  {t("add.group")}
                </Button>
                <Button variant="ghost" onClick={() => setSheet("pair")}>
                  {t("add.pair")}
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div
            className="mb-4 rounded-[7px] border px-3.5 py-4"
            style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
          >
            <Amount paise={overall} label={t("balances.overall")} hero />
            <p className="mt-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
              {t("home.overallCaption")}
            </p>
            {/* With one side at zero, that side is just the hero figure again. */}
            {owed !== 0 && owe !== 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-3 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
                <Amount
                  paise={owed}
                  label={t("home.owed")}
                  tone="neutral"
                  className="flex-col! items-start! whitespace-nowrap"
                />
                <Amount
                  paise={Math.abs(owe)}
                  label={t("home.owe")}
                  tone="neutral"
                  className="flex-col! items-start! whitespace-nowrap"
                />
              </div>
            )}
            {needsSettle && (
              <Button block className="mt-3" onClick={() => navigate("/balances")}>
                {t("home.settleUp")}
              </Button>
            )}
          </div>

          <SectionLabel
            action={
              restricted ? undefined : (
                <Button variant="ghost" size="sm" onClick={() => setSheet("choose")}>
                  {t("home.newLedger")}
                </Button>
              )
            }
          >
            {t("tabs.ledgers")}
          </SectionLabel>
          {active.map((ledger) => (
            <LedgerCard key={ledger.id} ledger={ledger} />
          ))}

          <RecentActivity />
        </>
      )}

      {/* Archived ledgers are settled history: present, but folded away so they never
          compete with the ledgers people are actually spending on. Shown even with no
          active ledgers, or they would vanish from home. */}
      {archived.length > 0 && (
        <details className="mt-5">
          <summary
            className={`flex min-h-11 cursor-pointer items-center rounded-[7px] border px-4 text-[14px] font-medium ${focusRing}`}
            style={{ borderColor: "var(--line-2)", color: "var(--ink-2)" }}
          >
            {t("home.archived", { count: archived.length })}
          </summary>
          <div className="mt-2">
            {archived.map((ledger) => (
              <LedgerCard key={ledger.id} ledger={ledger} />
            ))}
          </div>
        </details>
      )}

      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)} title={t("home.newLedger")}>
        {sheet === "choose" ? (
          <div className="flex flex-col gap-2">
            {KINDS.map((k) => (
              <Button key={k} variant="ghost" block onClick={() => setSheet(k)}>
                <span className="flex flex-col items-center gap-0.5 py-1">
                  <span className="text-[15px] font-semibold">{t(`add.${k}`)}</span>
                  <span className="text-[13px] font-normal" style={{ color: "var(--ink-3)" }}>
                    {t(`add.${k}Body`)}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          sheet && <LedgerForm kind={sheet} onDone={() => setSheet(null)} />
        )}
      </Sheet>
    </>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Amount,
  Button,
  Card,
  EmptyState,
  IconButton,
  LedgerMark,
  PageHeader,
  ScreenSkeleton,
  SectionHeading,
  Skeleton,
  focusRing,
} from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { sentence } from "~/client/components/ActivityRow";
import { LedgerForm, type LedgerKind } from "~/client/components/LedgerForm";
import {
  useLedgers,
  useMe,
  useRecentActivity,
  useTogglePin,
  type ActivityEvent,
  type LedgerSummary,
} from "~/client/lib/queries";
import { formatRelative } from "~/client/lib/format";
import { t } from "~/client/i18n";

const DAY = 86_400_000;
const KINDS: LedgerKind[] = ["trip", "group", "pair"];
export const daysLeft = (endDate: number) => Math.ceil((endDate - Date.now()) / DAY);

/** "4 days left" / "ended", or null for a ledger with no end date. The same phrase
 *  on the card and in the ledger's own header, so they cannot drift apart. */
export const runFor = (endDate: number | null) =>
  endDate === null
    ? null
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

/** One ledger as a row: identity, name, who and how recent, and the position.
 *  The star is a sibling of the link, not inside it: nested interactive elements are invalid. */
function LedgerCard({ ledger }: { ledger: LedgerSummary }) {
  const togglePin = useTogglePin(ledger.id);
  const archived = ledger.archivedAt !== null;
  const run = runFor(ledger.endDate);
  const meta = t(run ? "home.ledgerMetaRun" : "home.ledgerMeta", {
    members: t("expense.member", { count: ledger.memberCount }),
    run: run ?? "",
    activity: formatRelative(ledger.lastActivityAt),
  });

  return (
    <Card interactive className="row-in relative mb-2">
      {/* The link stretches into the card's padding so the whole row is the tap target. */}
      <Link to={`/ledgers/${ledger.id}`} className={`-mx-3.5 -my-3 flex gap-3 rounded-[7px] px-3.5 py-3 ${focusRing}`}>
        <span className="mt-1 flex-none">
          <LedgerMark size="md" color={ledger.color} emoji={ledger.emoji} name={ledger.name} />
        </span>
        <div className="min-w-0 flex-1">
          {/* pr-11 keeps the name clear of the star; the star is a 44px row of its own. */}
          <div className={`flex min-h-11 items-center text-[15px] font-medium ${archived ? "" : "pr-11"}`}>
            <span className="min-w-0 truncate">{ledger.name}</span>
          </div>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0 truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
              {meta}
            </div>
            <Amount paise={ledger.net} label={t("ledger.yourPosition")} className="shrink-0 whitespace-nowrap" />
          </div>
          <BurnRate ledger={ledger} />
        </div>
      </Link>
      {!archived && (
        <span className="absolute top-3 right-0">
          <IconButton
            icon={ledger.pinned ? "starFilled" : "star"}
            label={t(ledger.pinned ? "ledger.unpin" : "ledger.pin")}
            pressed={ledger.pinned}
            onClick={() => togglePin.mutate(!ledger.pinned)}
          />
        </span>
      )}
    </Card>
  );
}

/** What happened lately, across every ledger. Nothing here is a balance - it is
 *  history, so an empty feed just hides rather than claiming "all settled". Each
 *  row links to its ledger. */
function RecentActivity() {
  const { data, isPending, error } = useRecentActivity();
  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (error || (data ?? []).length === 0) return null;
  return (
    <section>
      <SectionHeading>{t("home.recent")}</SectionHeading>
      <ul className="rounded-[7px] border px-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        {data.map((e) => (
          <ActivityItem key={e.id} event={e} />
        ))}
      </ul>
    </section>
  );
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{sentence(event)}</span>
        <span className="block text-[13px]" style={{ color: "var(--ink-3)" }}>
          <time dateTime={new Date(event.at).toISOString()}>{formatRelative(event.at)}</time>
          {event.ledgerName && <> · {event.ledgerName}</>}
        </span>
      </span>
    </>
  );
  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
      {event.ledgerId ? (
        <Link to={`/ledgers/${event.ledgerId}`} className={`flex items-start gap-2.5 py-2.5 ${focusRing}`}>
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-2.5 py-2.5">{body}</div>
      )}
    </li>
  );
}

export function LedgersTab() {
  const { data, isPending, error, refetch } = useLedgers();
  const me = useMe();
  const navigate = useNavigate();
  // "choose" shows the three kinds; a kind shows its form. One sheet for both.
  const [sheet, setSheet] = useState<"choose" | LedgerKind | null>(null);

  if (isPending) return <ScreenSkeleton />;
  if (error)
    return (
      <EmptyState
        title={t("error.generic")}
        body={t("error.network")}
        action={
          <Button variant="ghost" onClick={() => refetch()}>
            {t("action.retry")}
          </Button>
        }
      />
    );

  const active = data.filter((l) => l.archivedAt === null);
  const archived = data.filter((l) => l.archivedAt !== null);
  const starred = active.filter((l) => l.pinned);
  const unstarred = active.filter((l) => !l.pinned);
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
  // The first heading carries the one "New ledger" action.
  const newLedger = restricted ? undefined : (
    <Button variant="ghost" size="sm" onClick={() => setSheet("choose")}>
      {t("home.newLedger")}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("app.name")}
        railTitle
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
                <Amount paise={owed} label={t("home.owed")} tone="neutral" stack className="whitespace-nowrap" />
                <Amount
                  paise={Math.abs(owe)}
                  label={t("home.owe")}
                  tone="neutral"
                  stack
                  className="whitespace-nowrap"
                />
              </div>
            )}
            {needsSettle && (
              <Button block className="mt-3" onClick={() => navigate("/balances")}>
                {t("home.settleUp")}
              </Button>
            )}
          </div>

          {/* Starred and the rest get their own headings only when both exist. */}
          {starred.length > 0 && unstarred.length > 0 ? (
            <>
              <SectionHeading action={newLedger}>{t("home.starred")}</SectionHeading>
              {starred.map((ledger) => (
                <LedgerCard key={ledger.id} ledger={ledger} />
              ))}
              <SectionHeading>{t("home.allLedgers")}</SectionHeading>
              {unstarred.map((ledger) => (
                <LedgerCard key={ledger.id} ledger={ledger} />
              ))}
            </>
          ) : (
            <>
              <SectionHeading action={newLedger}>{t("tabs.ledgers")}</SectionHeading>
              {active.map((ledger) => (
                <LedgerCard key={ledger.id} ledger={ledger} />
              ))}
            </>
          )}

          <div className="mt-5">
            <RecentActivity />
          </div>
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

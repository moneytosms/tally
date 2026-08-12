// The ledger's activity feed. Everything here is derived server-side - see
// src/server/routes/activity.ts for why there is no activity table.
import { Link, useParams } from "react-router";
import { EmptyState, ScreenSkeleton } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { ActivityRow, dayFormat } from "~/client/components/ActivityRow";
import { useActivity, useLedger, type ActivityEvent } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export default function ActivityTab() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const events = useActivity(ledgerId);

  if (events.isPending || ledger.isPending) return <ScreenSkeleton />;
  if (events.error || ledger.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const rows = events.data ?? [];

  // Grouped by day, so a busy ledger reads as a timeline rather than a wall.
  const groups: Array<{ day: string; events: ActivityEvent[] }> = [];
  for (const e of rows) {
    const day = dayFormat.format(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link
          to={`/ledgers/${ledgerId}`}
          aria-label={t("action.back")}
          className={`grid min-h-11 min-w-11 place-items-center text-[17px] ${focusRing}`}
          style={{ color: "var(--ink-3)" }}
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="serif truncate text-[21px] tracking-[-0.01em]">{t("activity.title")}</h1>
          <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
            {ledger.data.name}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState title={t("activity.title")} body={t("activity.none")} />
      ) : (
        groups.map((g) => (
          <section key={g.day} className="mb-4">
            <div
              className="mx-0.5 mb-1 text-[10.5px] tracking-[0.13em] uppercase"
              style={{ color: "var(--ink-3)" }}
            >
              {g.day}
            </div>
            <ul
              className="rounded-[7px] border px-3.5 py-1"
              style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
            >
              {g.events.map((e) => (
                <ActivityRow key={e.id} event={e} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

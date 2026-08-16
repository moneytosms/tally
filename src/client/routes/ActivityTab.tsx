// The ledger's activity feed. Everything here is derived server-side - see
// src/server/routes/activity.ts for why there is no activity table.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, Field, ScreenSkeleton, Select } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { ActivityRow, dayFormat } from "~/client/components/ActivityRow";
import { useActivity, useLedger, type ActivityEvent } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export type ActivityFilters = { member?: string; kind?: ActivityEvent["kind"] };

/** Pure so it is testable without rendering anything. `member` matches
 *  whichever of actorName/fromName/toName the event carries - the feed has no
 *  member id, only display names, so that is the only handle a filter has. */
export function filterEvents(events: ActivityEvent[], filters: ActivityFilters): ActivityEvent[] {
  return events.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (filters.member && e.actorName !== filters.member && e.fromName !== filters.member && e.toName !== filters.member)
      return false;
    return true;
  });
}

/** Distinct names/kinds actually present in the feed, so the filters never
 *  offer a choice that would produce an empty result. */
function distinctMembers(events: ActivityEvent[]): string[] {
  const names = new Set<string>();
  for (const e of events) {
    if (e.actorName) names.add(e.actorName);
    if (e.fromName) names.add(e.fromName);
    if (e.toName) names.add(e.toName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function distinctKinds(events: ActivityEvent[]): ActivityEvent["kind"][] {
  const kinds = new Set<ActivityEvent["kind"]>();
  for (const e of events) kinds.add(e.kind);
  return [...kinds];
}

export default function ActivityTab() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const events = useActivity(ledgerId);
  const [filters, setFilters] = useState<ActivityFilters>({});

  if (events.isPending || ledger.isPending) return <ScreenSkeleton />;
  if (events.error || ledger.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const all = events.data ?? [];
  const rows = filterEvents(all, filters);
  const filtering = filters.member !== undefined || filters.kind !== undefined;
  const patch = (p: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...p }));

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

      {/* Nothing to filter until there is a feed worth filtering. */}
      {all.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label={t("activity.filterMember")}>
            <Select value={filters.member ?? ""} onChange={(e) => patch({ member: e.target.value || undefined })}>
              <option value="">{t("activity.anyMember")}</option>
              {distinctMembers(all).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("activity.filterType")}>
            <Select
              value={filters.kind ?? ""}
              onChange={(e) => patch({ kind: (e.target.value || undefined) as ActivityEvent["kind"] | undefined })}
            >
              <option value="">{t("activity.anyType")}</option>
              {distinctKinds(all).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`activity.kindLabel.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          {filtering && (
            <div className="col-span-2 flex items-center justify-between gap-2" role="status" aria-live="polite">
              <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {t("activity.results", { count: rows.length, total: all.length })}
              </span>
              <button
                type="button"
                onClick={() => setFilters({})}
                className={`min-h-11 px-1 text-[12px] underline ${focusRing}`}
                style={{ color: "var(--moss)" }}
              >
                {t("activity.clear")}
              </button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        filtering ? (
          <EmptyState title={t("activity.title")} body={t("activity.noneFiltered")} />
        ) : (
          <EmptyState title={t("activity.title")} body={t("activity.none")} />
        )
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

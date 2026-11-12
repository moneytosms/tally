// The ledger's activity feed. Everything here is derived server-side - see
// src/server/routes/activity.ts for why there is no activity table.
import { useState } from "react";
import { useParams } from "react-router";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  ScreenSkeleton,
  SectionHeading,
  Select,
} from "~/client/components/ui";
import { ActivityRow } from "~/client/components/ActivityRow";
import { ExpenseSheet } from "~/client/components/ExpenseSheet";
import { FilterSheet } from "~/client/components/FilterSheet";
import { useActivity, useExpenses, useMembers, type ActivityEvent } from "~/client/lib/queries";
import { formatDate } from "~/client/lib/format";
import { t } from "~/client/i18n";

export type ActivityFilters = { member?: string; kind?: ActivityEvent["kind"] };

/** Pure so it is testable without rendering anything. `member` matches
 *  whichever of actorName/fromName/toName the event carries - the feed has no
 *  member id, only display names, so that is the only handle a filter has. */
export function filterEvents(events: ActivityEvent[], filters: ActivityFilters): ActivityEvent[] {
  return events.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (
      filters.member &&
      e.actorName !== filters.member &&
      e.fromName !== filters.member &&
      e.toName !== filters.member
    )
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
  const events = useActivity(ledgerId);
  // Only used to open an event's expense; the feed itself carries no expense data.
  const expenses = useExpenses(ledgerId);
  const members = useMembers(ledgerId);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (events.isPending) return <ScreenSkeleton />;
  if (events.error)
    return (
      <EmptyState
        title={t("error.generic")}
        body={t("error.network")}
        action={
          <Button size="sm" variant="ghost" onClick={() => events.refetch()}>
            {t("action.retry")}
          </Button>
        }
      />
    );

  const all = events.data ?? [];
  const rows = filterEvents(all, filters);
  const filtering = filters.member !== undefined || filters.kind !== undefined;
  const patch = (p: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clearAll = () => setFilters({});
  const opened = (expenses.data ?? []).find((e) => e.id === openId);

  // Grouped by day, so a busy ledger reads as a timeline rather than a wall.
  const groups: Array<{ day: string; events: ActivityEvent[] }> = [];
  for (const e of rows) {
    const day = formatDate(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }

  const filterButton = (
    <IconButton
      icon="filter"
      label={t("filter.activityOpen")}
      badge={(filters.member ? 1 : 0) + (filters.kind ? 1 : 0)}
      onClick={() => setSheetOpen(true)}
    />
  );

  return (
    <>
      {all.length > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px]" style={{ color: "var(--ink-3)" }} role="status" aria-live="polite">
            {filtering
              ? t("activity.results", { count: rows.length, total: all.length })
              : t("activity.count", { count: all.length })}
          </span>
          {filterButton}
        </div>
      )}

      {filtering && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filters.member && (
            <FilterChip
              removeLabel={t("filter.remove", { name: filters.member })}
              onRemove={() => patch({ member: undefined })}
            >
              {filters.member}
            </FilterChip>
          )}
          {filters.kind && (
            <FilterChip
              removeLabel={t("filter.remove", { name: t(`activity.kindLabel.${filters.kind}`) })}
              onRemove={() => patch({ kind: undefined })}
            >
              {t(`activity.kindLabel.${filters.kind}`)}
            </FilterChip>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        // The sentence is the title: the tab already says "Activity".
        filtering ? (
          <EmptyState
            title={t("activity.noneFiltered")}
            action={
              <Button size="sm" variant="ghost" onClick={clearAll}>
                {t("filter.clearAll")}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t("activity.none")} body={t("activity.noneBody")} />
        )
      ) : (
        groups.map((g) => (
          <section key={g.day}>
            <SectionHeading as="h3">{g.day}</SectionHeading>
            <Card>
              <ul>
                {g.events.map((e) => {
                  // A deleted expense has no row to open, so the event stays plain text.
                  const exists = (expenses.data ?? []).some((x) => x.id === e.expenseId);
                  return (
                    // The day is already the heading above this group.
                    <ActivityRow
                      key={e.id}
                      event={e}
                      showDay={false}
                      onOpen={exists ? () => setOpenId(e.expenseId) : undefined}
                    />
                  );
                })}
              </ul>
            </Card>
          </section>
        ))
      )}

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("filter.activityTitle")}
        showLabel={t("filter.showEvents", { count: rows.length })}
        onClear={clearAll}
      >
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
      </FilterSheet>

      {opened && (
        <ExpenseSheet
          ledgerId={ledgerId}
          expense={opened}
          members={members.data ?? []}
          open
          onOpenChange={(o) => !o && setOpenId(null)}
        />
      )}
    </>
  );
}

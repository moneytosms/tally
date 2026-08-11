// The ledger's activity feed. Everything here is derived server-side — see
// src/server/routes/activity.ts for why there is no activity table.
//
// The amount is never inlined into the sentence: it renders as <Amount>, which
// carries its own sign and label, because that is the only way a money value is
// allowed to reach the screen.
import { Link, useParams } from "react-router";
import { Amount, Avatar, EmptyState } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useActivity, useLedger, type ActivityEvent } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** The sentence for one event. All phrasing lives client-side; the server sends
 *  a `kind` and the parts, never assembled English. */
function sentence(e: ActivityEvent): string {
  const name = e.actorName ?? t("member.unknown");
  const description = e.description ?? t("expense.total");
  switch (e.kind) {
    case "settled":
    case "forgave":
      return t(`activity.${e.kind}`, {
        from: e.fromName ?? t("member.unknown"),
        to: e.toName ?? t("member.unknown"),
      });
    case "joined":
    case "left":
      return t(`activity.${e.kind}`, { name });
    default:
      return t(`activity.${e.kind}`, { name, description });
  }
}

/** A muted dot per kind. Never the ONLY cue — the sentence always says what
 *  happened, so this is reinforcement for people who scan. */
const dotColour: Record<ActivityEvent["kind"], string> = {
  added: "var(--moss)",
  edited: "var(--ochre)",
  deleted: "var(--clay)",
  settled: "var(--moss)",
  forgave: "var(--clay)",
  commented: "var(--ink-3)",
  joined: "var(--moss)",
  left: "var(--ink-3)",
};

function Row({ event }: { event: ActivityEvent }) {
  const who = event.actorName ?? event.fromName;
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <span className="mt-1.5 flex-none">
        {who ? (
          <Avatar name={who} />
        ) : (
          <span
            className="block size-2 rounded-full"
            style={{ background: dotColour[event.kind] }}
            aria-hidden="true"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px]">{sentence(event)}</div>
        <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          <time dateTime={new Date(event.at).toISOString()}>
            {dayFormat.format(event.at)} · {timeFormat.format(event.at)}
          </time>
        </div>
      </div>
      {event.amount !== null && (
        <div className="flex-none">
          <Amount
            paise={event.amount}
            label={t(event.kind === "added" || event.kind === "deleted" ? "activity.expenseLabel" : "activity.amountLabel")}
            tone="neutral"
          />
        </div>
      )}
    </li>
  );
}

export default function ActivityTab() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const events = useActivity(ledgerId);

  if (events.isPending || ledger.isPending) return null;
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
                <Row key={e.id} event={e} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

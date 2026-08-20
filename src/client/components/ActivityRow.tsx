// One row of the activity feed, shared by the ledger's own feed and the
// cross-ledger feed on the home tab, so the same event is phrased identically
// wherever it appears.
//
// The amount is never inlined into the sentence: it renders as <Amount>, which
// carries its own sign and label, because that is the only way a money value is
// allowed to reach the screen.
import { Amount, Avatar } from "~/client/components/ui";
import type { ActivityEvent } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** The sentence for one event. All phrasing lives client-side; the server sends
 *  a `kind` and the parts, never assembled English. */
export function sentence(e: ActivityEvent): string {
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

/** A muted dot per kind. Never the ONLY cue - the sentence always says what
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

export function ActivityRow({ event, showTime = true }: { event: ActivityEvent; showTime?: boolean }) {
  const who = event.actorName ?? event.fromName;
  return (
    <li className="row-in flex items-start gap-2.5 py-2.5">
      <span className="mt-1.5 flex-none">
        {who ? (
          <Avatar name={who} />
        ) : (
          <span className="block size-2 rounded-full" style={{ background: dotColour[event.kind] }} aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px]">{sentence(event)}</div>
        <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          <time dateTime={new Date(event.at).toISOString()}>
            {showTime ? `${dayFormat.format(event.at)} · ${timeFormat.format(event.at)}` : dayFormat.format(event.at)}
          </time>
          {/* On the home feed one sentence from two trips is otherwise identical. */}
          {event.ledgerName && <> · {event.ledgerName}</>}
          {/* Only worth saying when the payer is not the person who logged it. */}
          {(event.kind === "added" || event.kind === "deleted") &&
            event.fromName !== null &&
            event.fromName !== event.actorName && <> · {t("expense.paidByName", { name: event.fromName })}</>}
        </div>
      </div>
      {event.amount !== null && (
        <div className="flex-none">
          <Amount
            paise={event.amount}
            label={t(
              event.kind === "added" || event.kind === "deleted" ? "activity.expenseLabel" : "activity.amountLabel",
            )}
            tone="neutral"
          />
        </div>
      )}
    </li>
  );
}

// The only place a money value may reach the screen.
//
// Two invariants live here so they cannot be forgotten by a caller:
//   1. Never a bare number - a sign and a label are always rendered, and colour
//      only reinforces what the sign and the label already say.
//   2. Offline renders NO NUMBER AT ALL (SPEC §10). A wrong number about money
//      is worse than no number.
//
// `label` says WHAT the amount is ("your position", "total"). The sign says which
// direction. Don't put the direction in the label - you'll end up with "you owe −₹800".
//
// The spoken direction ("owed to you", "you owe") is ONLY true of the viewer's own
// net position. An expense total, a share, or another member's position is not the
// viewer's balance, so:
//   - tone="neutral" speaks no direction at all - it is a magnitude.
//   - `subject` names whose position it is, and the direction is spoken about them.
import { formatPaise, type Paise } from "~/shared/money";
import { useOnline } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export type AmountProps = {
  paise: Paise;
  /** Already localised - pass t("…"), not a key. */
  label: string;
  /** "position": a signed net position, moss/clay. "neutral": a magnitude, e.g. an expense total. */
  tone?: "position" | "neutral";
  /** Whose position this is, when it is not the viewer's. Spoken as "Priya owes".
   *  Omit for the viewer's own net; ignored entirely when tone="neutral". */
  subject?: string;
  /** Serif hero treatment, label stacked above. */
  hero?: boolean;
  className?: string;
};

export function Amount({ paise, label, tone = "position", subject, hero = false, className = "" }: AmountProps) {
  const online = useOnline();
  const direction = paise > 0 ? "positive" : paise < 0 ? "negative" : "zero";
  // A magnitude has no owed/owing direction to speak; only a position does.
  const spoken =
    tone === "neutral" ? "" : subject ? t(`amount.their.${direction}`, { name: subject }) : t(`amount.${direction}`);
  const sign = tone === "neutral" ? (paise < 0 ? "−" : "") : { positive: "+", negative: "−", zero: "±" }[direction];
  const color =
    tone === "neutral"
      ? "var(--ink)"
      : direction === "positive"
        ? "var(--moss)"
        : direction === "negative"
          ? "var(--clay)"
          : "var(--ink-2)";

  return (
    <span className={`inline-flex ${hero ? "flex-col items-start gap-1" : "items-baseline gap-1.5"} ${className}`}>
      <span className="text-[11.5px] leading-tight" style={{ color: "var(--ink-3)" }}>
        {label}
      </span>
      <span
        className={hero ? "serif tnum text-[30px] font-medium leading-none tracking-tight" : "tnum text-[14.5px]"}
        style={{ color: online ? color : "var(--ink-3)" }}
      >
        {online ? (
          <>
            {spoken && <span className="sr-only">{spoken} </span>}
            <span aria-hidden="true">{sign}</span>
            {formatPaise(Math.abs(paise))}
          </>
        ) : (
          t("offline.noAmount")
        )}
      </span>
    </span>
  );
}

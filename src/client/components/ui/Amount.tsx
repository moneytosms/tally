// The only place a money value may reach the screen.
//
// Two invariants live here so they cannot be forgotten by a caller:
//   1. Never a bare number - a sign and a label are always rendered, and colour
//      only reinforces what the sign and the words already say.
//   2. Offline renders NO NUMBER AT ALL (SPEC §10). A wrong number about money
//      is worse than no number.
//
// `label` says WHAT the amount is ("your position", "total"). The component renders
// the direction words itself ("You owe", "Priya is owed"); callers never do.
//
// The direction words are ONLY true of a position. An expense total, a share, or
// another member's position is not the viewer's balance, so:
//   - tone="neutral" shows no direction at all - it is a magnitude.
//   - `subject` names whose position it is, and the direction is said about them.
import { formatPaise, type Paise } from "~/shared/money";
import { useOnline } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export type AmountProps = {
  paise: Paise;
  /** Already localised - pass t("…"), not a key. */
  label: string;
  /** "position": a signed net position, moss/clay, with direction words. "neutral": a magnitude, e.g. an expense total. */
  tone?: "position" | "neutral";
  /** Whose position this is, when it is not the viewer's. Shown as "Priya owes".
   *  Omit for the viewer's own net; ignored entirely when tone="neutral". */
  subject?: string;
  /** Serif hero treatment, label stacked above. */
  hero?: boolean;
  className?: string;
};

export function Amount({ paise, label, tone = "position", subject, hero = false, className = "" }: AmountProps) {
  const online = useOnline();
  const direction = paise > 0 ? "positive" : paise < 0 ? "negative" : "zero";
  // Direction replaces the visible label for a position. Offline shows no amount,
  // so it shows no direction either - the label stays visible instead.
  const directionText =
    tone === "neutral" || !online
      ? ""
      : subject
        ? t(`amount.visible.their.${direction}`, { name: subject })
        : t(`amount.visible.${direction}`);
  const sign = tone === "neutral" ? (paise < 0 ? "−" : "") : { positive: "+", negative: "−", zero: "±" }[direction];
  const color =
    tone === "neutral"
      ? "var(--ink)"
      : direction === "positive"
        ? "var(--moss)"
        : direction === "negative"
          ? "var(--clay)"
          : "var(--ink-2)";
  const smallText = hero ? "text-[14px]" : "text-[13px]";

  return (
    <span className={`inline-flex ${hero ? "flex-col items-start gap-1" : "items-baseline gap-1.5"} ${className}`}>
      <span
        className={`${smallText} leading-tight ${directionText ? "sr-only" : ""}`}
        style={{ color: "var(--ink-3)" }}
      >
        {label}
      </span>
      {directionText && (
        <span className={`${smallText} leading-tight`} style={{ color: "var(--ink-2)" }}>
          {directionText}
        </span>
      )}
      <span
        className={hero ? "serif tnum text-[34px] font-medium leading-none tracking-tight" : "tnum text-[16px]"}
        style={{ color: online ? color : "var(--ink-3)" }}
      >
        {online ? (
          <>
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

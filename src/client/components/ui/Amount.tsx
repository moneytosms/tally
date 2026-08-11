// The only place a money value may reach the screen.
//
// Two invariants live here so they cannot be forgotten by a caller:
//   1. Never a bare number — a sign and a label are always rendered, and colour
//      only reinforces what the sign and the label already say.
//   2. Offline renders NO NUMBER AT ALL (SPEC §10). A wrong number about money
//      is worse than no number.
//
// `label` says WHAT the amount is ("your position", "total"). The sign says which
// direction. Don't put the direction in the label — you'll end up with "you owe −₹800".
import { formatPaise, type Paise } from "~/shared/money";
import { useOnline } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export type AmountProps = {
  paise: Paise;
  /** Already localised — pass t("…"), not a key. */
  label: string;
  /** "position": a signed net position, moss/clay. "neutral": a magnitude, e.g. an expense total. */
  tone?: "position" | "neutral";
  /** Serif hero treatment, label stacked above. */
  hero?: boolean;
  className?: string;
};

export function Amount({ paise, label, tone = "position", hero = false, className = "" }: AmountProps) {
  const online = useOnline();
  const direction = paise > 0 ? "positive" : paise < 0 ? "negative" : "zero";
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
            <span className="sr-only">{t(`amount.${direction}`)} </span>
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

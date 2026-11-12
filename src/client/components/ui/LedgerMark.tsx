import { LEDGER_COLOR_VALUES } from "~/shared/schemas";

export type LedgerColor = (typeof LEDGER_COLOR_VALUES)[number];

// Stored values are fixed; the hue each one shows is set by its --ledger-* token.
const COLOR_VARS: Record<LedgerColor, { solid: string; wash: string }> = {
  moss: { solid: "var(--ledger-moss)", wash: "var(--ledger-moss-wash)" },
  clay: { solid: "var(--ledger-clay)", wash: "var(--ledger-clay-wash)" },
  ochre: { solid: "var(--ledger-ochre)", wash: "var(--ledger-ochre-wash)" },
  plum: { solid: "var(--ledger-plum)", wash: "var(--ledger-plum-wash)" },
  sky: { solid: "var(--ledger-sky)", wash: "var(--ledger-sky-wash)" },
  rose: { solid: "var(--ledger-rose)", wash: "var(--ledger-rose-wash)" },
};

/** CSS vars for a ledger colour, or undefined when the ledger has none. */
export function ledgerColorVar(color: LedgerColor | null | undefined) {
  return color ? COLOR_VARS[color] : undefined;
}

const SIZES = {
  sm: { box: 24, text: 13, emoji: 14 },
  md: { box: 36, text: 16, emoji: 18 },
  lg: { box: 44, text: 18, emoji: 22 },
};

/** A ledger's identity tile. Decorative: the ledger's name is always shown as text
 *  beside it. The glyph sits in ink on the wash, so it stays readable in every theme. */
export function LedgerMark({
  color,
  emoji,
  name,
  size = "md",
}: {
  color?: LedgerColor | null;
  emoji?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const s = SIZES[size];
  const vars = ledgerColorVar(color);
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-[6px] border leading-none"
      style={{
        width: s.box,
        height: s.box,
        background: vars?.wash ?? "var(--paper-sunk)",
        borderColor: vars?.solid ?? "var(--line)",
        color: "var(--ink)",
        fontSize: emoji ? s.emoji : s.text,
        fontWeight: emoji ? 400 : 600,
      }}
    >
      {emoji || letter}
    </span>
  );
}

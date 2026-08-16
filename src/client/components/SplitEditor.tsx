// Split modes, per-participant values, and a live preview of the resolved paise.
//
// The maths is NOT here. `resolveSplits` in ~/shared/money owns it, including the
// rounding rule; this file only collects input and renders what that returns.
//
// The rupee-string parsers live here too because this is the module that owns the
// money input path. ExpenseForm and SettleUp import them (a separate lib file
// isn't mine to add, and a cycle back through ExpenseForm would be worse).
import { resolveSplits, type SplitMode } from "~/shared/money";
import { Amount, Avatar, Field, Input } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { t } from "~/client/i18n";

export type SplitParticipant = { memberId: string; name: string };

/** Rupees typed by a human -> integer paise. String surgery only: `Number(x) * 100`
 *  is a float in the money path and turns 32.99 into 3298.9999999999995.
 *  Returns null for anything that isn't an amount. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/[,\s]/g, "").replace(/^−/, "-");
  const m = /^(-?)(\d*)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || (!m[2] && m[3] === undefined)) return null;
  const paise = Number(m[2] || "0") * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -paise : paise;
}

/** Integer paise -> "1234.56", by string construction. Never `paise / 100`. */
export function paiseToRupeeString(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Raw text per participant -> the numbers resolveSplits wants. NaN is deliberate:
 *  it fails resolveSplits' integer check rather than silently becoming 0. */
export function splitValues(
  mode: SplitMode,
  participants: SplitParticipant[],
  raw: Record<string, string>,
): number[] | undefined {
  if (mode === "equal") return undefined;
  return participants.map((p) => {
    const text = (raw[p.memberId] ?? "").trim();
    if (mode === "exact") return rupeesToPaise(text) ?? NaN;
    return /^\d+$/.test(text) ? Number(text) : NaN;
  });
}

const errorKeys: Array<[RegExp, string]> = [
  [/exact splits/, "expense.error.exactSum"],
  [/percents must sum/, "expense.error.percentSum"],
  [/value per participant|integers/, "expense.error.numbers"],
  [/positive/, "expense.error.positiveValue"],
  [/one participant/, "expense.error.noParticipants"],
  [/out of range/, "expense.error.tooLarge"],
  [/total must be/, "expense.error.amount"],
];

export type PreviewInput = {
  total: number;
  mode: SplitMode;
  payerIndex: number;
  participants: SplitParticipant[];
  raw: Record<string, string>;
};

/** The single source of truth for "is this expense saveable, and what will it store".
 *  ExpenseForm calls it to gate submit; SplitEditor calls it to draw the preview. */
export function preview(input: PreviewInput): { splits: number[] } | { error: string } {
  const { total, mode, payerIndex, participants, raw } = input;
  try {
    return {
      splits: resolveSplits({
        total,
        mode,
        participantCount: participants.length,
        payerIndex,
        values: splitValues(mode, participants, raw),
      }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const hit = errorKeys.find(([re]) => re.test(message));
    return { error: t(hit ? hit[1] : "expense.error.split") };
  }
}

const modes: SplitMode[] = ["equal", "exact", "shares", "percent"];

/**
 * The answer to "so what do I owe", in one line, for the case where one line is
 * the whole truth: an equal split that divides exactly.
 *
 * It is deliberately NOT used when the shares differ. Odd paise go to the payer,
 * so "₹33.33 each" across three people on ₹100 is a wrong number about money -
 * and a wrong number is the one thing this app does not do. That case falls back
 * to the per-person list, which shows the ₹33.34 too.
 */
function PerHead({ each, count }: { each: number; count: number }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 rounded-[7px] border px-3.5 py-3"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      <Amount paise={each} label={t("expense.splitEvenly")} tone="neutral" />
      <span className="flex-none text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("expense.selectedCount", { count })}
      </span>
    </div>
  );
}

export function SplitEditor({
  total,
  mode,
  payerIndex,
  participants,
  raw,
  onModeChange,
  onRawChange,
}: PreviewInput & {
  onModeChange: (mode: SplitMode) => void;
  onRawChange: (raw: Record<string, string>) => void;
}) {
  const result = preview({ total, mode, payerIndex, participants, raw });
  const splits = "splits" in result ? result.splits : undefined;
  // A blank amount is not a split error - the amount field says that itself.
  const error = total !== 0 && "error" in result ? result.error : undefined;
  const isRefund = total < 0;
  const unit = t(`expense.value.${mode}`);
  // "Equal" is the mode; "even" is whether it actually came out that way.
  const evenSplit =
    mode === "equal" && splits !== undefined && splits.length > 0 && splits.every((s) => s === splits[0]);

  return (
    <section className="mb-3">
      <div
        className="mb-3 flex items-center justify-between gap-3 rounded-[7px] border px-3.5 py-3"
        style={{
          background: "var(--paper-2)",
          borderColor: isRefund ? "var(--moss)" : "var(--line)",
          borderLeft: isRefund ? "2px solid var(--moss)" : undefined,
        }}
      >
        <Amount paise={total} label={t("expense.total")} tone="neutral" />
        {isRefund && (
          <span
            className="rounded-[5px] border px-1.5 py-0.5 text-[10.5px] tracking-[0.13em] uppercase"
            style={{ borderColor: "var(--moss)", background: "var(--moss-wash)", color: "var(--moss-2)" }}
          >
            {t("expense.refund")}
          </span>
        )}
      </div>
      {isRefund && (
        <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-2)" }}>
          {t("expense.refundNote")}
        </p>
      )}

      {/* Field carries the split-level error so it is announced with the section
          it belongs to. role=group, not a nested control, so the <label> has
          nothing to steal focus to. */}
      <Field label={t("expense.split")} error={error}>
        <div role="group" aria-label={t("expense.split")} className="flex flex-wrap gap-1.5">
          {modes.map((m) => {
            const on = m === mode;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => onModeChange(m)}
                className={`min-h-11 min-w-11 rounded-[6px] border px-3 text-[13.5px] ${focusRing}`}
                style={{
                  background: on ? "var(--moss-wash)" : "transparent",
                  borderColor: on ? "var(--moss)" : "var(--line-2)",
                  color: on ? "var(--moss-2)" : "var(--ink-2)",
                }}
              >
                {t(`expense.splitMode.${m}`)}
              </button>
            );
          })}
        </div>
      </Field>

      {/* An even split has nothing to type and nothing to compare, so one line
          says all of it. Everything else - the other modes, and an equal split
          with a remainder - still needs the per-person list. Membership is the
          picker's job now, so no row carries a remove button. */}
      {evenSplit ? (
        <PerHead each={splits?.[0] ?? 0} count={participants.length} />
      ) : (
        <ul
          className="rounded-[7px] border px-3.5 py-1"
          style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
        >
          {participants.map((p, i) => (
            <li
              key={p.memberId}
              className="flex items-center gap-2.5 border-b py-2 last:border-b-0"
              style={{ borderColor: "var(--line)" }}
            >
              <Avatar name={p.name} />
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {p.name}
                {i === payerIndex && (
                  <span className="ml-1.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {t("expense.payerMark")}
                  </span>
                )}
              </span>
              {/* An equal split reaches this list only to SHOW an uneven
                  remainder. There is nothing to type in that mode. */}
              {mode !== "equal" && (
                <span className="w-[104px] flex-none">
                  <Input
                    inputMode="decimal"
                    value={raw[p.memberId] ?? ""}
                    aria-label={`${p.name} - ${unit}`}
                    onChange={(e) => onRawChange({ ...raw, [p.memberId]: e.target.value })}
                  />
                </span>
              )}
              <span className="w-[92px] flex-none text-right">
                {splits ? (
                  <Amount paise={splits[i] ?? 0} label={t("expense.shareLabel")} tone="neutral" />
                ) : (
                  <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                    {t("expense.sharePending")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Only worth saying when there IS a remainder to explain. On an even
          split it is a warning about something that did not happen. */}
      {!evenSplit && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
          {t("expense.remainderNote")}
        </p>
      )}
    </section>
  );
}

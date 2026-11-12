// "why?" - the trail behind a suggested transfer. SPEC §6 calls this a
// requirement, not a nicety: it is the answer to the complaint that always-on
// simplification reliably produces.
//
// <details> is keyboard reachable and announced as a disclosure with no JS.
//
// The trail is computed SERVER-SIDE and arrives on the transfer (see
// trailFor in src/server/routes/balances.ts). It has to be: the client's
// expense list cannot see settlements, so a trail built here could only ever
// list gross expenses and would disagree with the very number it sits under
// the moment anyone settled partially. Every row that moved money between
// these two people is in it, signed, including the settlements.
//
// transferPlan() is a greedy net-position simplification: a suggested transfer
// can still legitimately be between two people who share nothing at all. That
// is what `explained` distinguishes - a trail that accounts for the whole
// amount says so by saying nothing, and anything short of it says so out loud
// rather than implying the list is complete.
import { Amount } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import type { TrailRow } from "~/client/lib/queries";
import { formatDate } from "~/client/lib/format";
import { t } from "~/client/i18n";

/** The disclosure summary, shared with SettleUp's direct-debts disclosure: looks like a ghost sm Button. */
export const disclosureSummaryClass = `inline-flex min-h-11 cursor-pointer list-none items-center rounded-[7px] border px-3 text-[14px] font-medium ${focusRing}`;

/** Signed paise the trail accounts for, from the transfer's own direction:
 *  positive is "part of why `from` owes `to`". */
export function trailNet(rows: TrailRow[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

/** Does the trail account for the whole suggested amount? Only then is the list
 *  the complete answer to "why?". */
export function fullyExplained(rows: TrailRow[], amount: number): boolean {
  return rows.length > 0 && trailNet(rows) === amount;
}

/** The disclosure. Uncontrolled unless `open` is given: then the caller owns it
 *  and hears each change through `onToggle`. */
export function WhyTrail({
  fromName,
  toName,
  amount,
  trail,
  open,
  onToggle,
}: {
  fromName: string;
  toName: string;
  amount: number;
  trail: TrailRow[];
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details className="mt-1" open={open} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary
        className={disclosureSummaryClass}
        style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
        aria-label={t("settle.showTrailFor", { from: fromName, to: toName })}
      >
        {t("settle.showTrail")}
      </summary>
      <TrailList fromName={fromName} toName={toName} amount={amount} trail={trail} />
    </details>
  );
}

/** The trail rows, always expanded. WhyTrail wraps them in a disclosure; the
 *  printed settle report shows them straight. */
export function TrailList({
  fromName,
  toName,
  amount,
  trail,
}: {
  fromName: string;
  toName: string;
  amount: number;
  trail: TrailRow[];
}) {
  return trail.length === 0 ? (
    <p className="py-2 text-[13px] text-[var(--ink-3)]">{t("settle.trailSimplified")}</p>
  ) : (
    <>
      <ul className="mt-1 mb-1">
        {trail.map((r) => {
          // The sign already says who paid: a row that adds to what `from`
          // owes came from `to`'s pocket, and vice versa.
          const payer = r.amount > 0 ? toName : fromName;
          return (
            <li
              key={`${r.kind}-${r.id}`}
              className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">
                  {r.kind === "settlement" ? t("settle.trailSettlement") : r.description}
                </span>
                <span className="block text-[13px] text-[var(--ink-3)]">
                  {t("settle.trailMeta", {
                    date: formatDate(r.at),
                    by:
                      r.kind === "settlement"
                        ? t("settle.trailSettledBy", { name: payer })
                        : t("expense.paidByName", { name: payer }),
                  })}
                </span>
              </span>
              {/* Sign is from the payer-of-the-transfer's side: negative = they
                      owe it. `subject` makes the spoken direction match - this is
                      never the viewer's own balance. */}
              <Amount paise={-r.amount} label={t("settle.trailShare", { name: fromName })} subject={fromName} />
            </li>
          );
        })}
      </ul>
      {!fullyExplained(trail, amount) && (
        <p className="py-2 text-[13px] text-[var(--ink-3)]">{t("settle.trailSimplified")}</p>
      )}
    </>
  );
}

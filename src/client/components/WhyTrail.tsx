// "why?" - the trail behind a suggested transfer. SPEC §6 calls this a
// requirement, not a nicety: it is the answer to the complaint that always-on
// simplification reliably produces.
//
// <details> is keyboard reachable and announced as a disclosure with no JS.
//
// transferPlan() is a greedy net-position simplification (src/server/balances.ts):
// a suggested transfer can legitimately be between two people who share zero
// direct expenses. The direct-expense list below is real and correctly netted,
// but for a multi-hop simplification it is not the whole story - see
// `fullyExplained` and settle.trailSimplified.
import { Amount } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useExpenses, useMembers } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export type TrailRow = {
  expenseId: string;
  description: string;
  paidAt: number;
  paidByTo: boolean;
  share: number; // paise, unsigned
};

export function directTrail(
  expenses: Array<{
    id: string;
    payerMemberId: string;
    description: string;
    paidAt: number;
    splits: Array<{ memberId: string; amount: number }>;
  }>,
  fromMemberId: string,
  toMemberId: string,
): TrailRow[] {
  return expenses
    .filter(
      (e) =>
        (e.payerMemberId === toMemberId && e.splits.some((s) => s.memberId === fromMemberId)) ||
        (e.payerMemberId === fromMemberId && e.splits.some((s) => s.memberId === toMemberId)),
    )
    .map((e) => {
      const paidByTo = e.payerMemberId === toMemberId;
      const share = e.splits.find((s) => s.memberId === (paidByTo ? fromMemberId : toMemberId))?.amount ?? 0;
      return { expenseId: e.id, description: e.description, paidAt: e.paidAt, paidByTo, share };
    })
    .sort((a, b) => b.paidAt - a.paidAt);
}

/** Net signed paise the direct trail accounts for, from `from`'s side
 *  (negative = from owes it, matching `Amount`'s sign convention elsewhere). */
export function directTrailNet(rows: TrailRow[]): number {
  return rows.reduce((sum, r) => sum + (r.paidByTo ? -r.share : r.share), 0);
}

export function WhyTrail({
  ledgerId,
  fromMemberId,
  toMemberId,
  amount,
}: {
  ledgerId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}) {
  // ponytail: both queries are already cached per ledger by TanStack Query, so a
  // trail per transfer row costs one fetch, not N.
  const expenses = useExpenses(ledgerId);
  const members = useMembers(ledgerId);
  const name = (id: string) => (members.data ?? []).find((m) => m.id === id)?.nickname ?? t("member.unknown");

  const rows = directTrail(expenses.data ?? [], fromMemberId, toMemberId);
  const net = directTrailNet(rows);
  const fullyExplained = rows.length > 0 && -net === amount;

  return (
    <details className="mt-1">
      <summary
        className={`inline-flex min-h-11 cursor-pointer list-none items-center text-[12px] underline ${focusRing}`}
        style={{ color: "var(--ink-3)" }}
        aria-label={t("settle.whyFor", { from: name(fromMemberId), to: name(toMemberId) })}
      >
        {t("settle.why")}
      </summary>
      {rows.length === 0 ? (
        <p className="py-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
          {t("settle.trailSimplified")}
        </p>
      ) : (
        <>
          <ul className="mt-1 mb-1">
            {rows.map((r) => (
              <li key={r.expenseId} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{r.description}</span>
                  <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {day.format(r.paidAt)} · {t("expense.paidByName", { name: name(r.paidByTo ? toMemberId : fromMemberId) })}
                  </span>
                </span>
                {/* Sign is from the payer-of-the-transfer's side: negative = they owe
                    it. `subject` makes the spoken direction match - this is never the
                    viewer's own balance. */}
                <Amount
                  paise={r.paidByTo ? -r.share : r.share}
                  label={t("settle.trailShare", { name: name(fromMemberId) })}
                  subject={name(fromMemberId)}
                />
              </li>
            ))}
          </ul>
          {!fullyExplained && (
            <p className="py-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
              {t("settle.trailSimplified")}
            </p>
          )}
        </>
      )}
    </details>
  );
}

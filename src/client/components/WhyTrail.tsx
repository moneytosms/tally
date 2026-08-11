// "why?" — the trail behind a suggested transfer. SPEC §6 calls this a
// requirement, not a nicety: it is the answer to the complaint that always-on
// simplification reliably produces.
//
// <details> is keyboard reachable and announced as a disclosure with no JS.
import { Amount } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useExpenses, useMembers } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export function WhyTrail({
  ledgerId,
  fromMemberId,
  toMemberId,
}: {
  ledgerId: string;
  fromMemberId: string;
  toMemberId: string;
}) {
  // ponytail: both queries are already cached per ledger by TanStack Query, so a
  // trail per transfer row costs one fetch, not N.
  const expenses = useExpenses(ledgerId);
  const members = useMembers(ledgerId);
  const name = (id: string) => (members.data ?? []).find((m) => m.id === id)?.nickname ?? t("member.unknown");

  const rows = (expenses.data ?? [])
    .filter(
      (e) =>
        (e.payerMemberId === toMemberId && e.splits.some((s) => s.memberId === fromMemberId)) ||
        (e.payerMemberId === fromMemberId && e.splits.some((s) => s.memberId === toMemberId)),
    )
    .sort((a, b) => b.paidAt - a.paidAt);

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
          {t("settle.trailEmpty")}
        </p>
      ) : (
        <ul className="mt-1 mb-1">
          {rows.map((e) => {
            const paidByTo = e.payerMemberId === toMemberId;
            const share = e.splits.find((s) => s.memberId === (paidByTo ? fromMemberId : toMemberId))?.amount ?? 0;
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{e.description}</span>
                  <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {day.format(e.paidAt)} · {t("expense.paidByName", { name: name(e.payerMemberId) })}
                  </span>
                </span>
                {/* Sign is from the payer-of-the-transfer's side: negative = they owe it. */}
                <Amount paise={paidByTo ? -share : share} label={t("settle.trailShare", { name: name(fromMemberId) })} />
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

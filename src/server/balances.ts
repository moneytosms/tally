// Net positions are DERIVED — never stored, never cached. ADR 0004, SPEC §6.
// Integer paise throughout: every operation here is addition, subtraction or Math.min.
import type { Paise } from "~/shared/money";

/** Positive = the member is owed. Negative = the member owes. */
export type NetPosition = { memberId: string; net: Paise };
export type Transfer = { fromMemberId: string; toMemberId: string; amount: Paise };

/**
 * An expense credits its payer the sum of its splits and debits each participant
 * their resolved split. Splits sum to the total (enforced at write time), so the
 * ledger sums to zero structurally rather than by convention.
 *
 * A refund is an expense with negative splits — the same arithmetic, no branch.
 * A guest is just a memberId. A `forgiven` settlement is just a settlement.
 */
export function netPositions(
  expenses: Array<{ payerMemberId: string; splits: Array<{ memberId: string; amount: Paise }> }>,
  settlements: Array<{ fromMemberId: string; toMemberId: string; amount: Paise }>,
): NetPosition[] {
  const net = new Map<string, Paise>();
  const add = (memberId: string, delta: Paise) => net.set(memberId, (net.get(memberId) ?? 0) + delta);

  for (const e of expenses) {
    for (const s of e.splits) {
      add(e.payerMemberId, s.amount);
      add(s.memberId, -s.amount);
    }
  }
  // `from` paid `to`, so `from` owes that much less and `to` is owed that much less.
  for (const s of settlements) {
    add(s.fromMemberId, s.amount);
    add(s.toMemberId, -s.amount);
  }

  return [...net].map(([memberId, n]) => ({ memberId, net: n }));
}

/**
 * Greedy simplification: match the largest creditor against the largest debtor,
 * repeatedly. At most n-1 transfers, and applying them zeroes every position.
 */
export function transferPlan(positions: NetPosition[]): Transfer[] {
  // ponytail: sorted once, not re-sorted per step. Each step exhausts at least one
  // side, so the transfer count (<= n-1) is unaffected by the stale ordering.
  const creditors = positions.filter((p) => p.net > 0).map((p) => ({ ...p })).sort((a, b) => b.net - a.net);
  const debtors = positions.filter((p) => p.net < 0).map((p) => ({ memberId: p.memberId, net: -p.net })).sort((a, b) => b.net - a.net);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const credit = creditors[c]!;
    const debt = debtors[d]!;
    const amount = Math.min(credit.net, debt.net);
    transfers.push({ fromMemberId: debt.memberId, toMemberId: credit.memberId, amount });
    credit.net -= amount;
    debt.net -= amount;
    if (credit.net === 0) c++;
    if (debt.net === 0) d++;
  }
  return transfers;
}

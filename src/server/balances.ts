// Net positions are DERIVED - never stored, never cached. ADR 0004, SPEC §6.
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
 * A refund is an expense with negative splits - the same arithmetic, no branch.
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
  const creditors = positions
    .filter((p) => p.net > 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => b.net - a.net);
  const debtors = positions
    .filter((p) => p.net < 0)
    .map((p) => ({ memberId: p.memberId, net: -p.net }))
    .sort((a, b) => b.net - a.net);

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

type Expenses = Array<{
  id: string;
  description: string;
  paidAt: number;
  payerMemberId: string;
  splits: Array<{ memberId: string; amount: Paise }>;
}>;
type Settlements = Array<{
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Paise;
  note: string | null;
  declaredAt: number;
}>;

/**
 * The "why?" trail behind one suggested transfer: every direct movement between
 * `from` and `to`, signed so that POSITIVE means "this is part of why `from`
 * owes `to`".
 *
 * Both directions and every settlement, because a one-directional, settlement-
 * blind trail is what makes "why?" disagree with the number above it: an expense
 * `from` paid, or a partial settle already recorded, is exactly the reason the
 * suggested amount is smaller than the sum of the rows.
 *
 * A trail whose rows sum to the transfer amount explains it completely; anything
 * left over is simplification (`from` and `to` need share no expense at all) and
 * the UI says so rather than implying the list is the whole story.
 */
export function trailFor(expenses: Expenses, settlements: Settlements, from: string, to: string) {
  const rows = expenses.flatMap((e) => {
    // A payer who is not `from` or `to` cannot put the two of them in direct
    // contact, whoever else took a share.
    if (e.payerMemberId !== from && e.payerMemberId !== to) return [];
    const other = e.payerMemberId === to ? from : to;
    const s = e.splits.find((x) => x.memberId === other);
    if (!s || s.amount === 0) return [];
    return [
      {
        kind: "expense" as const,
        id: e.id,
        expenseId: e.id,
        description: e.description,
        at: e.paidAt,
        // `to` paid and `from` took a share: `from` owes it. The other way round
        // it is the same money running the other way, so it subtracts.
        amount: e.payerMemberId === to ? s.amount : -s.amount,
      },
    ];
  });

  // A settlement is money that has already moved, so it cancels exactly as much
  // of the obligation as it was worth. `forgiven` is arithmetically identical.
  const paid = settlements.flatMap((st) => {
    const between =
      (st.fromMemberId === from && st.toMemberId === to) || (st.fromMemberId === to && st.toMemberId === from);
    if (!between || st.amount === 0) return [];
    return [
      {
        kind: "settlement" as const,
        id: st.id,
        expenseId: null,
        description: st.note ?? "",
        at: st.declaredAt,
        amount: st.fromMemberId === from ? -st.amount : st.amount,
      },
    ];
  });

  return [...rows, ...paid].sort((a, b) => b.at - a.at);
}

/** Who owes whom before simplification, settlements included. A simplified
 *  transfer often runs between two people with no shared expense; this is what
 *  makes that one explainable ("you owe B, B owes C"). */
export function grossPairs(expenses: Expenses, settlements: Settlements) {
  const acc = new Map<string, Paise>();
  const add = (from: string, to: string, amount: Paise) => {
    // One key per unordered pair, so a settlement running the other way nets
    // against the expenses rather than appearing as a second, opposite debt.
    const flip = from > to;
    const key = flip ? `${to}\u0000${from}` : `${from}\u0000${to}`;
    acc.set(key, (acc.get(key) ?? 0) + (flip ? -amount : amount));
  };

  for (const e of expenses) {
    for (const s of e.splits) {
      if (s.memberId === e.payerMemberId || s.amount === 0) continue;
      add(s.memberId, e.payerMemberId, s.amount);
    }
  }
  for (const st of settlements) add(st.toMemberId, st.fromMemberId, st.amount);

  return [...acc].flatMap(([key, amount]) => {
    if (amount === 0) return [];
    const [a, b] = key.split("\u0000") as [string, string];
    return amount > 0
      ? [{ fromMemberId: a, toMemberId: b, amount }]
      : [{ fromMemberId: b, toMemberId: a, amount: -amount }];
  });
}

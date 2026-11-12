// Settle up. SPEC §6: the payer declares, the payee is notified, not asked, and
// the balance moves on declaration.
//
// The manual path is a peer of the UPI path, never behind it - a missing UPI app
// is a silent, undetectable no-op, so nothing may depend on the link opening.
//
// This screen is the one place a member checks the arithmetic by hand: every
// figure comes from the server, and the only sum computed here is the visible
// check line over net positions. Nothing here changes a calculation.
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Amount,
  Avatar,
  Button,
  EmptyState,
  Field,
  Input,
  Rupees,
  ScreenSkeleton,
  Sheet,
  Skeleton,
  pushToast,
} from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { SettleGraph, type Selection } from "~/client/components/SettleGraph";
import { WhyTrail, disclosureSummaryClass, fullyExplained } from "~/client/components/WhyTrail";
import { dayFormat } from "~/client/components/ActivityRow";
import { paiseToRupeeString, rupeesToPaise } from "~/client/components/SplitEditor";
import { formatPaise } from "~/shared/money";
import {
  useBalances,
  useCreateSettlement,
  useCrossLedgerBalances,
  useExpenseSearch,
  useLedger,
  useMe,
  useMembers,
  useNudge,
  useOnline,
} from "~/client/lib/queries";
import { ApiError } from "~/client/lib/api";
import { t } from "~/client/i18n";

export type SettleMethod = "upi" | "manual" | "forgiven";

/** Partial settles are first-class: anything above zero and up to the suggestion. */
export function settleAmount(raw: string, suggested: number): { paise: number } | { error: string } {
  const paise = rupeesToPaise(raw);
  if (paise === null || paise <= 0) return { error: t("settle.errorAmount") };
  if (paise > suggested) return { error: t("settle.errorTooMuch") };
  return { paise };
}

/** `am` is rupees with two decimals, built from the integer paise as a string.
 *  Never `paise / 100` - this is the money path. */
export function upiLink(input: { vpa: string; name: string; paise: number; note?: string }): string {
  const q = [
    `pa=${encodeURIComponent(input.vpa)}`,
    `pn=${encodeURIComponent(input.name)}`,
    `am=${paiseToRupeeString(input.paise)}`,
    "cu=INR",
  ];
  if (input.note) q.push(`tn=${encodeURIComponent(input.note)}`);
  return `upi://pay?${q.join("&")}`;
}

/** The viewer's own position first, then everyone else by name. */
export function sortPositions<T extends { memberId: string; name: string }>(rows: T[], viewerId?: string): T[] {
  return [...rows].sort((a, b) =>
    a.memberId === viewerId ? -1 : b.memberId === viewerId ? 1 : a.name.localeCompare(b.name),
  );
}

/** Transfers the viewer pays come first; the rest keep the server's order. */
export function sortTransfers<T extends { fromMemberId: string }>(rows: T[], viewerId?: string): T[] {
  return [...rows].sort((a, b) => Number(b.fromMemberId === viewerId) - Number(a.fromMemberId === viewerId));
}

/** Integer paise, so exact. Zero when the server's net positions balance. */
export function netSum(positions: Array<{ net: number }>): number {
  return positions.reduce((sum, p) => sum + p.net, 0);
}

type Transfer = { fromMemberId: string; toMemberId: string; amount: number };
type TransferKey = { fromMemberId: string; toMemberId: string };

/** The open transfer, looked up fresh: if it was settled elsewhere it is gone, so the sheet closes. */
export function activeTransfer<T extends TransferKey>(transfers: T[], key: TransferKey | null): T | null {
  if (!key) return null;
  return transfers.find((tr) => tr.fromMemberId === key.fromMemberId && tr.toMemberId === key.toMemberId) ?? null;
}

/** UPI needs the payee's VPA; without one the method is manual, whatever was picked before. */
export function effectiveMethod(method: SettleMethod, hasVpa: boolean): SettleMethod {
  return method === "upi" && !hasVpa ? "manual" : method;
}

/** Why a suggested transfer exists when its own trail does not explain it: the
 *  direct debts around its payer and payee. The transfer's own pair is left out,
 *  since a direct debt is the trail, not a reroute. */
export function reroutedReason<P extends { fromMemberId: string; toMemberId: string; amount: number }>(
  transfer: TransferKey,
  pairs: P[],
): { payerOwes: P[]; payeeOwed: P[] } {
  const others = pairs.filter(
    (p) => !(p.fromMemberId === transfer.fromMemberId && p.toMemberId === transfer.toMemberId),
  );
  return {
    payerOwes: others.filter((p) => p.fromMemberId === transfer.fromMemberId),
    payeeOwed: others.filter((p) => p.toMemberId === transfer.toMemberId),
  };
}

/** One plain sentence per member. Repeats the name rather than using pronouns. */
export function memberLine(p: {
  name: string;
  paid: number;
  share: number;
  settledOut: number;
  settledIn: number;
  net: number;
}): string {
  const out = p.settledOut !== 0 ? t("settle.graph.sentenceSettledOut", { amount: formatPaise(p.settledOut) }) : "";
  const inn = p.settledIn !== 0 ? t("settle.graph.sentenceSettledIn", { amount: formatPaise(p.settledIn) }) : "";
  const outcome =
    p.net > 0
      ? t("settle.graph.outcomeOwed", { name: p.name, amount: formatPaise(p.net) })
      : p.net < 0
        ? t("settle.graph.outcomeOwes", { name: p.name, amount: formatPaise(-p.net) })
        : t("settle.graph.outcomeSettled", { name: p.name });
  const base = t("settle.graph.sentence", {
    name: p.name,
    paid: formatPaise(p.paid),
    share: formatPaise(p.share),
  });
  return t("settle.graph.sentenceFull", { base, out, inn, outcome });
}

const card = { background: "var(--paper-2)", borderColor: "var(--line)" };
const muted = { color: "var(--ink-3)" };
const item = `flex min-h-11 w-full items-center px-3.5 py-2.5 text-left text-[15px] ${focusRing}`;

/** A reminder to whoever owes me. The endpoint and its 12-hour server-side rate
 *  limit already existed; nothing in the UI ever called it. Guests have no user,
 *  so there is nobody to notify - the button is simply absent for them. */
function Nudge({ ledgerId, toUserId }: { ledgerId: string; toUserId: string | null }) {
  const nudge = useNudge();
  if (toUserId === null) return null;

  const message = nudge.isSuccess
    ? t("notifications.nudgeSent")
    : nudge.error instanceof ApiError && nudge.error.code === "too_soon"
      ? t("notifications.nudgeTooSoon")
      : nudge.error
        ? t("error.generic")
        : "";

  return (
    <div className="mt-1.5 flex items-center gap-2.5">
      <Button
        size="sm"
        variant="ghost"
        disabled={nudge.isPending || nudge.isSuccess}
        onClick={() => nudge.mutate({ ledgerId, toUserId })}
      >
        {t("notifications.nudge")}
      </Button>
      <span role="status" aria-live="polite" className="text-[13px]" style={muted}>
        {message}
      </span>
    </div>
  );
}

/** Mounted only when a member is selected, so the expense list is fetched lazily. */
function MemberExpenses({ ledgerId, memberId, name }: { ledgerId: string; memberId: string; name: string }) {
  const expenses = useExpenseSearch(ledgerId, { memberId });
  if (expenses.isPending || expenses.isPlaceholderData)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  if (expenses.isError)
    return (
      <p role="alert" className="text-[13px]" style={{ color: "var(--clay)" }}>
        {t("settle.graph.loadFailed")}
      </p>
    );
  if (expenses.data.length === 0)
    return (
      <p className="text-[13px]" style={muted}>
        {t("settle.graph.noExpenses", { name })}
      </p>
    );
  return (
    <ul>
      {expenses.data.map((e) => {
        const share = e.splits.find((s) => s.memberId === memberId);
        return (
          <li
            key={e.id}
            className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="min-w-0">
              <div className="truncate text-[15px]">{e.description}</div>
              <div className="text-[13px]" style={muted}>
                {dayFormat.format(e.paidAt)}
              </div>
            </div>
            <div className="flex flex-none flex-col items-end gap-1">
              {e.payerMemberId === memberId && (
                <Amount paise={e.total} label={t("settle.graph.paidLabel")} tone="neutral" />
              )}
              {share && <Amount paise={share.amount} label={t("settle.graph.shareLabel")} tone="neutral" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function SettleUp() {
  const { ledgerId = "" } = useParams();
  const balances = useBalances(ledgerId);
  const members = useMembers(ledgerId);
  const me = useMe();
  const friends = useCrossLedgerBalances();
  const create = useCreateSettlement(ledgerId);

  const ledger = useLedger(ledgerId);
  const [activeKey, setActiveKey] = useState<TransferKey | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<SettleMethod>("manual");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");
  const online = useOnline();
  const [view, setView] = useState<"plan" | "direct">("plan");
  const [selection, setSelection] = useState<Selection | null>(null);

  const roster = members.data ?? [];
  const member = (id: string) => roster.find((m) => m.id === id);
  const myMemberId = roster.find((m) => m.userId === me.data?.id)?.id;
  const vpaOf = (id: string) => {
    const userId = member(id)?.userId;
    return userId ? ((friends.data ?? []).find((f) => f.userId === userId)?.vpa ?? null) : null;
  };

  // Any input change makes the last failure stale.
  const changeAmount = (raw: string) => {
    setAmountRaw(raw);
    setFailure("");
  };
  const changeMethod = (m: SettleMethod) => {
    setMethod(m);
    setFailure("");
  };

  const open = (tr: Transfer) => {
    setActiveKey({ fromMemberId: tr.fromMemberId, toMemberId: tr.toMemberId });
    setAmountRaw(paiseToRupeeString(tr.amount));
    setMethod(vpaOf(tr.toMemberId) ? "upi" : "manual");
    setNote("");
    setFailure("");
  };

  if (balances.isPending) return <ScreenSkeleton />;
  if (balances.isError) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const { positions, transfers, pairs, settlements, totals } = balances.data;
  // Server names are authoritative here, including for members who have left.
  const name = (id: string) =>
    positions.find((p) => p.memberId === id)?.name || member(id)?.nickname || t("member.unknown");
  const idle = roster.filter((m) => !positions.some((p) => p.memberId === m.id));
  const sum = netSum(positions);
  const archived = Boolean(ledger.data?.archivedAt);

  const active = activeTransfer(transfers, activeKey);
  // Settled elsewhere: forget the key, so the same pair later doesn't reopen this sheet.
  if (activeKey && !active) setActiveKey(null);
  const payeeVpa = active ? vpaOf(active.toMemberId) : null;
  const shown = effectiveMethod(method, Boolean(payeeVpa));
  const parsed = active ? settleAmount(amountRaw, active.amount) : null;
  const paise = parsed && "paise" in parsed ? parsed.paise : null;
  const sheetTitle = active ? t("settle.pays", { from: name(active.fromMemberId), to: name(active.toMemberId) }) : "";

  const named = sortPositions(
    positions.map((p) => ({ ...p, name: name(p.memberId) })),
    myMemberId,
  );
  const edges = view === "plan" ? transfers : pairs;
  const edgeSel =
    selection?.kind === "edge"
      ? (edges.find((e) => e.fromMemberId === selection.fromMemberId && e.toMemberId === selection.toMemberId) ?? null)
      : null;
  const memberSel =
    selection?.kind === "member" ? (named.find((p) => p.memberId === selection.memberId) ?? null) : null;
  // Gone from this view or data: forget it, so it cannot reappear later (same pattern as activeKey).
  if (selection && !edgeSel && !memberSel) setSelection(null);
  const trailOf = edgeSel?.trail ?? [];
  const rerouted =
    view === "plan" && edgeSel && !fullyExplained(trailOf, edgeSel.amount) ? reroutedReason(edgeSel, pairs) : null;
  const showRerouted = rerouted !== null && rerouted.payerOwes.length + rerouted.payeeOwed.length > 0;

  async function record() {
    if (!active || paise === null) return;
    setFailure("");
    try {
      await create.mutateAsync({
        fromMemberId: active.fromMemberId,
        toMemberId: active.toMemberId,
        amount: paise,
        method: shown,
        note: note.trim() || null,
      });
      setActiveKey(null);
      pushToast(t("settle.recorded"), "success");
    } catch (err) {
      setFailure(err instanceof ApiError && err.code === "offline" ? t("offline.body") : t("settle.failed"));
    }
  }

  return (
    <>
      {archived && (
        <p className="mb-4 text-[13px]" style={muted}>
          {t("settle.archivedNote")}
        </p>
      )}

      <section className="mb-6">
        <div className="flex items-end justify-between gap-3 rounded-[7px] border px-3.5 py-3" style={card}>
          <Amount paise={totals.spent} label={t("settle.totalSpent")} tone="neutral" />
          <span className="text-[13px]" style={muted}>
            {t("settle.expenseCount", { count: totals.expenseCount })}
          </span>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-[15px] font-semibold">{t("settle.netHeading")}</h2>
        <p className="mb-3 text-[13px]" style={muted}>
          {t("settle.netExplain")}
        </p>
        {sortPositions(
          positions.map((p) => ({ ...p, name: name(p.memberId) })),
          myMemberId,
        ).map((p) => {
          const mine = p.memberId === myMemberId;
          return (
            <div key={p.memberId} className="mb-2 rounded-[7px] border px-3.5 py-3" style={card}>
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={p.name} />
                  <span className="truncate text-[15px] font-medium">
                    {mine ? t("settle.you", { name: p.name }) : p.name}
                  </span>
                </div>
                <Amount
                  paise={p.net}
                  label={t("settle.netPosition")}
                  tone="position"
                  subject={mine ? undefined : p.name}
                />
              </div>
              <div className="mt-2.5 flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
                <Amount paise={p.paid} label={t("settle.paid")} tone="neutral" className="w-full justify-between" />
                <Amount
                  paise={p.share}
                  label={t("settle.shareOfExpenses")}
                  tone="neutral"
                  className="w-full justify-between"
                />
                {p.settledOut !== 0 && (
                  <Amount
                    paise={p.settledOut}
                    label={t("settle.settlementsSent")}
                    tone="neutral"
                    className="w-full justify-between"
                  />
                )}
                {p.settledIn !== 0 && (
                  <Amount
                    paise={p.settledIn}
                    label={t("settle.settlementsReceived")}
                    tone="neutral"
                    className="w-full justify-between"
                  />
                )}
              </div>
            </div>
          );
        })}
        {idle.map((m) => (
          <p key={m.id} className="mb-1 text-[13px]" style={muted}>
            {t("settle.noActivity", { name: m.nickname })}
          </p>
        ))}
        <div className="mt-3">
          {sum === 0 ? (
            <Amount paise={0} label={t("settle.checkLabel")} tone="neutral" />
          ) : (
            <p role="alert" className="text-[13px]" style={{ color: "var(--clay)" }}>
              {t("settle.checkFailed")} <Amount paise={sum} label={t("settle.checkSum")} tone="neutral" />
            </p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-[15px] font-semibold">{t("settle.graph.heading")}</h2>
        <p className="mb-3 text-[13px]" style={muted}>
          {t("settle.graph.explain")}
        </p>
        {!online ? (
          <p className="text-[13px]" style={muted}>
            {t("offline.body")}
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {(["plan", "direct"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={disclosureSummaryClass}
                  style={{
                    borderColor: "var(--line-2)",
                    color: "var(--ink)",
                    background: view === v ? "var(--paper-sunk)" : undefined,
                    fontWeight: view === v ? 600 : 500,
                  }}
                >
                  {t(v === "plan" ? "settle.graph.planView" : "settle.graph.directView")}
                </button>
              ))}
            </div>

            {named.length > 0 && (
              <SettleGraph
                positions={named.map((p) => ({ memberId: p.memberId, name: p.name, net: p.net }))}
                edges={edges}
                selected={selection}
                onSelect={setSelection}
                label={t("settle.graph.label")}
              />
            )}

            {edgeSel && (
              <div className="mt-3 mb-2 rounded-[7px] border px-3.5 py-3" style={card}>
                <div className="text-[15px] font-medium">
                  {view === "plan"
                    ? t("settle.pays", { from: name(edgeSel.fromMemberId), to: name(edgeSel.toMemberId) })
                    : t("settle.owes", { from: name(edgeSel.fromMemberId), to: name(edgeSel.toMemberId) })}
                </div>
                <Amount paise={edgeSel.amount} label={t("settle.amount")} tone="neutral" className="mt-1" />
                <WhyTrail
                  ledgerId={ledgerId}
                  fromMemberId={edgeSel.fromMemberId}
                  toMemberId={edgeSel.toMemberId}
                  amount={edgeSel.amount}
                  trail={trailOf}
                />
                {showRerouted && rerouted && (
                  <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
                    <h3 className="mb-1 text-[13px] font-medium">{t("settle.graph.reroutedHeading")}</h3>
                    {[...rerouted.payerOwes, ...rerouted.payeeOwed].map((p) => (
                      <Amount
                        key={`${p.fromMemberId}-${p.toMemberId}`}
                        paise={p.amount}
                        label={t("settle.owes", { from: name(p.fromMemberId), to: name(p.toMemberId) })}
                        tone="neutral"
                        className="w-full justify-between"
                      />
                    ))}
                    <p className="mt-1 text-[13px]" style={muted}>
                      {t("settle.graph.rerouted", { from: name(edgeSel.fromMemberId), to: name(edgeSel.toMemberId) })}
                    </p>
                  </div>
                )}
              </div>
            )}

            {memberSel && (
              <div className="mt-3 mb-2 rounded-[7px] border px-3.5 py-3" style={card}>
                <p className="text-[14px]">{memberLine(memberSel)}</p>
                <h3 className="mt-3 mb-1 text-[13px] font-medium">
                  {t("settle.graph.detailMember", { name: memberSel.name })}
                </h3>
                <MemberExpenses
                  key={memberSel.memberId}
                  ledgerId={ledgerId}
                  memberId={memberSel.memberId}
                  name={memberSel.name}
                />
              </div>
            )}

            <div className="mt-3">
              {named.map((p) => (
                <p key={p.memberId} className="mb-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
                  {memberLine(p)}
                </p>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-[15px] font-semibold">{t("settle.whoHeading")}</h2>
        <p className="mb-3 text-[13px]" style={muted}>
          {t("settle.whoExplain")}
        </p>
        {transfers.length === 0 ? (
          <EmptyState title={t("settle.allSettled")} />
        ) : (
          sortTransfers(transfers, myMemberId).map((tr) => {
            const mine = tr.fromMemberId === myMemberId;
            const owedToMe = tr.toMemberId === myMemberId;
            return (
              <div
                key={`${tr.fromMemberId}-${tr.toMemberId}`}
                className="mb-2 rounded-[7px] border px-3.5 py-3"
                style={card}
              >
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium">
                      {t("settle.pays", { from: name(tr.fromMemberId), to: name(tr.toMemberId) })}
                    </div>
                    <Amount paise={tr.amount} label={t("settle.amount")} tone="neutral" className="mt-1" />
                  </div>
                  {archived ? null : mine ? (
                    <Button onClick={() => open(tr)}>{t("settle.startSettle")}</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => open(tr)}>
                      {t("settle.recordFor", { name: name(tr.fromMemberId) })}
                    </Button>
                  )}
                </div>
                {owedToMe && !archived && (
                  <Nudge ledgerId={ledgerId} toUserId={member(tr.fromMemberId)?.userId ?? null} />
                )}
                <WhyTrail
                  ledgerId={ledgerId}
                  fromMemberId={tr.fromMemberId}
                  toMemberId={tr.toMemberId}
                  amount={tr.amount}
                  trail={tr.trail ?? []}
                />
              </div>
            );
          })
        )}
        {pairs.length > 0 && (
          <details className="mt-1">
            <summary className={disclosureSummaryClass} style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}>
              {t("settle.pairsSummary")}
            </summary>
            <p className="py-2 text-[13px]" style={muted}>
              {t("settle.pairsExplain")}
            </p>
            <ul>
              {pairs.map((p) => (
                <li
                  key={`${p.fromMemberId}-${p.toMemberId}`}
                  className="border-b py-1.5 last:border-b-0"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Amount
                    paise={p.amount}
                    label={t("settle.owes", { from: name(p.fromMemberId), to: name(p.toMemberId) })}
                    tone="neutral"
                    className="w-full justify-between"
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-[15px] font-semibold">{t("settle.settlementsHeading")}</h2>
        {settlements.length === 0 ? (
          <p className="text-[13px]" style={muted}>
            {t("settle.noSettlements")}
          </p>
        ) : (
          settlements.map((s) => {
            const date = dayFormat.format(s.declaredAt);
            const method = t(`settle.method.${s.method}`);
            const meta = s.note
              ? t("settle.recordMetaNote", { date, method, note: s.note })
              : t("settle.recordMeta", { date, method });
            return (
              <div
                key={s.id}
                className="mb-2 flex items-center justify-between gap-3 rounded-[7px] border px-3.5 py-3"
                style={card}
              >
                <div className="min-w-0">
                  <div className="text-[15px]">
                    {s.method === "forgiven"
                      ? t("settle.wroteOff", { from: name(s.fromMemberId), to: name(s.toMemberId) })
                      : t("settle.paidTo", { from: name(s.fromMemberId), to: name(s.toMemberId) })}
                  </div>
                  <div className="text-[13px]" style={muted}>
                    {meta}
                  </div>
                </div>
                <Amount paise={s.amount} label={t("settle.amount")} tone="neutral" />
              </div>
            );
          })
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-[15px] font-semibold">{t("settle.export.heading")}</h2>
        {!online ? (
          <p className="text-[13px]" style={muted}>
            {t("offline.body")}
          </p>
        ) : (
          <ul className="rounded-[7px] border" style={card}>
            <li className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <a href={`/api/ledgers/${ledgerId}/settle.csv`} download className={item}>
                {t("settle.export.csv")}
              </a>
            </li>
            <li className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <a href={`/api/ledgers/${ledgerId}/settle.xlsx`} download className={item}>
                {t("settle.export.xlsx")}
              </a>
            </li>
            <li className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <Link to="report" className={item}>
                {t("settle.export.pdf")}
              </Link>
            </li>
          </ul>
        )}
      </section>

      <Sheet open={active !== null} onOpenChange={(o) => !o && setActiveKey(null)} title={sheetTitle}>
        {active && (
          <>
            <Field label={t("settle.amount")} error={parsed && "error" in parsed ? parsed.error : undefined}>
              <Rupees value={amountRaw} onChange={changeAmount} />
              <span className="mt-1.5 block text-[13px]" style={muted}>
                {t("settle.partialHint")}
              </span>
            </Field>

            <div className="mb-3 flex items-center gap-4">
              {paise !== active.amount && <Amount paise={active.amount} label={t("settle.suggested")} tone="neutral" />}
              {paise !== null && paise < active.amount && (
                <Amount paise={active.amount - paise} label={t("settle.remaining")} tone="neutral" />
              )}
            </div>

            <fieldset className="mb-3">
              <legend className="mb-1.5 block text-[13px] tracking-[0.13em] uppercase" style={muted}>
                {t("settle.methodLabel")}
              </legend>
              {(["upi", "manual", "forgiven"] as const).map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-2.5 text-[14px]">
                  <input
                    type="radio"
                    name="settle-method"
                    className={focusRing}
                    checked={shown === m}
                    disabled={m === "upi" && !payeeVpa}
                    onChange={() => changeMethod(m)}
                  />
                  <span>{t(`settle.method.${m}`)}</span>
                </label>
              ))}
              {!payeeVpa && (
                <p className="text-[13px]" style={muted}>
                  {t("settle.noVpa", { name: name(active.toMemberId) })}
                </p>
              )}
              {shown === "forgiven" && (
                <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                  {t("settle.forgivenExplain")}
                </p>
              )}
            </fieldset>

            {/* Convenience on top of the record, never a substitute for it. */}
            {shown === "upi" && payeeVpa && paise !== null && (
              <a
                href={upiLink({ vpa: payeeVpa, name: name(active.toMemberId), paise, note: t("app.name") })}
                className={`mb-3 inline-flex min-h-11 items-center rounded-[6px] border px-4 text-[14px] ${focusRing}`}
                style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
              >
                {t("settle.openUpi")}
              </a>
            )}

            <Field label={t("settle.note")}>
              <Input
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setFailure("");
                }}
              />
            </Field>

            <p role="alert" aria-live="assertive" className="mb-2 text-[13px]" style={{ color: "var(--clay)" }}>
              {failure}
            </p>

            <Button block disabled={paise === null} isLoading={create.isPending} onClick={record}>
              {t("settle.record")}
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}

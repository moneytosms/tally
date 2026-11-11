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
import { useParams } from "react-router";
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
  pushToast,
} from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { WhyTrail, disclosureSummaryClass } from "~/client/components/WhyTrail";
import { dayFormat } from "~/client/components/ActivityRow";
import { paiseToRupeeString, rupeesToPaise } from "~/client/components/SplitEditor";
import {
  useBalances,
  useCreateSettlement,
  useCrossLedgerBalances,
  useLedger,
  useMe,
  useMembers,
  useNudge,
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

const card = { background: "var(--paper-2)", borderColor: "var(--line)" };
const muted = { color: "var(--ink-3)" };

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
                  trail={tr.trail}
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

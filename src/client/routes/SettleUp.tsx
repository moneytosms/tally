// Settle up. SPEC §6: the payer declares, the payee is notified, not asked, and
// the balance moves on declaration.
//
// The manual path is a peer of the UPI path, never behind it - a missing UPI app
// is a silent, undetectable no-op, so nothing may depend on the link opening.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Amount, Avatar, Button, EmptyState, Field, Input, Rupees, Sheet } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { WhyTrail } from "~/client/components/WhyTrail";
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

type Transfer = { fromMemberId: string; toMemberId: string; amount: number };

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
      <span role="status" aria-live="polite" className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {message}
      </span>
    </div>
  );
}

export default function SettleUp() {
  const { ledgerId = "" } = useParams();
  const ledger = useLedger(ledgerId);
  const balances = useBalances(ledgerId);
  const members = useMembers(ledgerId);
  const me = useMe();
  const friends = useCrossLedgerBalances();
  const create = useCreateSettlement(ledgerId);

  const [active, setActive] = useState<Transfer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<SettleMethod>("manual");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");

  const roster = members.data ?? [];
  const member = (id: string) => roster.find((m) => m.id === id);
  const name = (id: string) => member(id)?.nickname ?? t("member.unknown");
  const myMemberId = roster.find((m) => m.userId === me.data?.id)?.id;
  const vpaOf = (id: string) => {
    const userId = member(id)?.userId;
    return userId ? ((friends.data ?? []).find((f) => f.userId === userId)?.vpa ?? null) : null;
  };

  const open = (tr: Transfer) => {
    setActive(tr);
    setAmountRaw(paiseToRupeeString(tr.amount));
    setMethod(vpaOf(tr.toMemberId) ? "upi" : "manual");
    setNote("");
    setFailure("");
  };

  const transfers = balances.data?.transfers ?? [];
  const payeeVpa = active ? vpaOf(active.toMemberId) : null;
  const parsed = active ? settleAmount(amountRaw, active.amount) : null;
  const paise = parsed && "paise" in parsed ? parsed.paise : null;

  async function record() {
    if (!active || paise === null) return;
    setFailure("");
    try {
      await create.mutateAsync({
        fromMemberId: active.fromMemberId,
        toMemberId: active.toMemberId,
        amount: paise,
        method,
        note: note.trim() || null,
      });
      setActive(null);
    } catch (err) {
      setFailure(err instanceof ApiError && err.code === "offline" ? t("offline.body") : t("settle.failed"));
    }
  }

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link
          to={`/ledgers/${ledgerId}`}
          aria-label={t("action.back")}
          className={`grid min-h-11 min-w-11 place-items-center text-[17px] ${focusRing}`}
          style={{ color: "var(--ink-3)" }}
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="serif truncate text-[21px] tracking-[-0.01em]">{t("settle.title")}</h1>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {ledger.data?.name} · {t("settle.fewestTransfers")}
          </div>
        </div>
      </header>

      {transfers.length === 0 ? (
        <EmptyState title={t("empty.balances")} body={t("settle.nothingBody")} />
      ) : (
        transfers.map((tr) => {
          const mine = tr.fromMemberId === myMemberId;
          const owedToMe = tr.toMemberId === myMemberId;
          return (
            <div
              key={`${tr.fromMemberId}-${tr.toMemberId}`}
              className="mb-2 rounded-[7px] border px-3.5 py-3"
              style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={name(tr.fromMemberId)} />
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px]">
                      {t("settle.pays", { from: name(tr.fromMemberId), to: name(tr.toMemberId) })}
                    </div>
                    <Amount paise={tr.amount} label={t("settle.suggested")} tone="neutral" />
                  </div>
                </div>
                <Button size="sm" onClick={() => open(tr)}>
                  {mine ? t("settle.title") : t("settle.recordOnBehalf")}
                </Button>
              </div>
              {/* "Record on their behalf" with no explanation reads like the only
                  thing you are allowed to do. Say why, and offer the alternative. */}
              {!mine && (
                <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {t("settle.notYoursHint", { name: name(tr.fromMemberId) })}
                </p>
              )}
              {owedToMe && <Nudge ledgerId={ledgerId} toUserId={member(tr.fromMemberId)?.userId ?? null} />}
              <WhyTrail ledgerId={ledgerId} fromMemberId={tr.fromMemberId} toMemberId={tr.toMemberId} />
            </div>
          );
        })
      )}

      <Sheet open={active !== null} onOpenChange={(o) => !o && setActive(null)} title={t("settle.title")}>
        {active && (
          <>
            <p className="mb-3 text-[13px]" style={{ color: "var(--ink-2)" }}>
              {t("settle.pays", { from: name(active.fromMemberId), to: name(active.toMemberId) })}
            </p>

            <Field label={t("settle.amount")} error={parsed && "error" in parsed ? parsed.error : undefined}>
              <Rupees value={amountRaw} onChange={setAmountRaw} />
              <span className="mt-1.5 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                {t("settle.partialHint")}
              </span>
            </Field>

            <div className="mb-3 flex items-center gap-4">
              <Amount paise={active.amount} label={t("settle.suggested")} tone="neutral" />
              {paise !== null && paise < active.amount && (
                <Amount paise={active.amount - paise} label={t("settle.remaining")} tone="neutral" />
              )}
            </div>

            <fieldset className="mb-3">
              <legend className="mb-1.5 block text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
                {t("settle.methodLabel")}
              </legend>
              {(["upi", "manual", "forgiven"] as const).map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-2.5 text-[14px]">
                  <input
                    type="radio"
                    name="settle-method"
                    className={focusRing}
                    checked={method === m}
                    disabled={m === "upi" && !payeeVpa}
                    onChange={() => setMethod(m)}
                  />
                  <span>{t(`settle.method.${m}`)}</span>
                </label>
              ))}
              {!payeeVpa && (
                <p className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {t("settle.noVpa", { name: name(active.toMemberId) })}
                </p>
              )}
              {method === "forgiven" && (
                <p className="text-[11.5px]" style={{ color: "var(--ink-2)" }}>
                  {t("settle.forgivenExplain")}
                </p>
              )}
            </fieldset>

            {/* Convenience on top of the record, never a substitute for it. */}
            {method === "upi" && payeeVpa && paise !== null && (
              <a
                href={upiLink({ vpa: payeeVpa, name: name(active.toMemberId), paise, note: t("app.name") })}
                className={`mb-3 inline-flex min-h-11 items-center rounded-[6px] border px-4 text-[14px] ${focusRing}`}
                style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
              >
                {t("settle.openUpi")}
              </a>
            )}

            <Field label={t("settle.note")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            <p role="alert" aria-live="assertive" className="mb-2 text-[12px]" style={{ color: "var(--clay)" }}>
              {failure}
            </p>

            <Button className="w-full" disabled={paise === null} isLoading={create.isPending} onClick={record}>
              {t("settle.record")}
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}

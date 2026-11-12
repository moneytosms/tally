// Balances tab. SPEC §10: "what do I owe Rahul overall" is a different question
// from "what happened on the Goa trip", so it gets its own tab.
//
// Cross-ledger net per friend on top. Below, one card per ledger that links to that
// ledger's Settle tab, where the full plan and its trails live. The per-ledger
// transfers are still loaded here, because bulk settle needs them.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Amount,
  Avatar,
  Button,
  EmptyState,
  focusRing,
  Icon,
  PageHeader,
  pushToast,
  Sheet,
} from "~/client/components/ui";
import { upiLink } from "~/client/routes/SettleUp";
import {
  qk,
  useBalances,
  useCrossLedgerBalances,
  useLedgers,
  useMe,
  useMembers,
  type CrossLedgerBalance,
  type LedgerSummary,
} from "~/client/lib/queries";
import { api } from "~/client/lib/api";
import { formatPaise } from "~/shared/money";
import { t } from "~/client/i18n";

/** One leg of a bulk settle: what I owe one person in one ledger. */
type Contribution = {
  ledgerId: string;
  ledgerName: string;
  fromMemberId: string;
  toMemberId: string;
  toUserId: string | null;
  amount: number;
};

export default function BalancesTab() {
  const friends = useCrossLedgerBalances();
  const ledgers = useLedgers();
  const [legs, setLegs] = useState<Record<string, Contribution[]>>({});
  const [bulkFor, setBulkFor] = useState<CrossLedgerBalance | null>(null);

  const report = useCallback((ledgerId: string, list: Contribution[]) => {
    setLegs((prev) => ({ ...prev, [ledgerId]: list }));
  }, []);

  const open = (ledgers.data ?? []).filter((l) => l.archivedAt === null);
  const all = Object.values(legs).flat();
  const rows = friends.data ?? [];
  // One primary button per screen: only the first row the viewer has to settle gets it.
  const firstOwing = rows.find((f) => -f.net < 0)?.userId;

  return (
    <>
      <PageHeader title={t("tabs.balances")} subtitle={t("balances.subtitle")} />

      {rows.length === 0 ? (
        <EmptyState title={t("empty.balances")} body={t("balances.emptyBody")} />
      ) : (
        rows.map((f) => {
          // The API returns the obligation from THEIR side ("positive = they are
          // owed, by me"). Every label and colour in this row is written from the
          // viewer's side, so flip it once, here, rather than at each use.
          const mine = -f.net;
          return (
            <div
              key={f.userId}
              className="mb-2 flex items-center justify-between gap-2.5 rounded-[7px] border px-3.5 py-3"
              style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={f.displayName} />
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{f.displayName}</div>
                  <Amount paise={mine} label={t("balances.overall")} />
                </div>
              </div>
              {mine < 0 && (
                <Button size="sm" variant={f.userId === firstOwing ? "primary" : "ghost"} onClick={() => setBulkFor(f)}>
                  {t("balances.settleUp")}
                </Button>
              )}
            </div>
          );
        })
      )}

      {/* Guests have no VPA and no user, so they never reach this tab. Said out
          loud rather than silently omitted (SPEC §6) - but only once there is a
          list for them to be missing from. */}
      {rows.length > 0 && (
        <p className="mt-2 mb-5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("balances.guestsSkipped")}
        </p>
      )}

      <h2 className="mx-0.5 mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
        {t("balances.perLedger")}
      </h2>
      {open.map((l) => (
        <LedgerPlan key={l.id} ledger={l} onLegs={report} />
      ))}

      <Sheet open={bulkFor !== null} onOpenChange={(o) => !o && setBulkFor(null)} title={t("balances.settleAcross")}>
        {bulkFor && (
          <BulkSettle
            friend={bulkFor}
            legs={all.filter((c) => c.toUserId === bulkFor.userId)}
            onDone={() => setBulkFor(null)}
          />
        )}
      </Sheet>
    </>
  );
}

function LedgerPlan({ ledger, onLegs }: { ledger: LedgerSummary; onLegs: (id: string, legs: Contribution[]) => void }) {
  const balances = useBalances(ledger.id);
  const members = useMembers(ledger.id);
  const me = useMe();

  const roster = members.data ?? [];
  const myMemberId = roster.find((m) => m.userId === me.data?.id)?.id;
  const transfers = balances.data?.transfers ?? [];

  const mine = transfers
    .filter((tr) => tr.fromMemberId === myMemberId)
    .map((tr) => ({
      ledgerId: ledger.id,
      ledgerName: ledger.name,
      fromMemberId: tr.fromMemberId,
      toMemberId: tr.toMemberId,
      toUserId: roster.find((m) => m.id === tr.toMemberId)?.userId ?? null,
      amount: tr.amount,
    }));

  // Serialised dep: the array identity changes every render, the contents don't.
  const key = JSON.stringify(mine);
  useEffect(() => {
    onLegs(ledger.id, JSON.parse(key) as Contribution[]);
  }, [key, ledger.id, onLegs]);

  // The whole row is the way in: one target, not a row plus a button repeated per ledger.
  return (
    <Link
      to={`/ledgers/${ledger.id}/settle`}
      className={`row-press mb-2 flex items-center gap-2.5 rounded-[7px] border px-3.5 py-3 ${focusRing}`}
      style={{ background: "var(--paper-2)", borderColor: "var(--line)", color: "var(--ink)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{ledger.name}</div>
        <Amount paise={ledger.net} label={t("ledger.yourPosition")} />
      </div>
      <span className="flex flex-none items-center gap-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
        {t("balances.seeHow")}
        <Icon name="forward" size={16} />
      </span>
    </Link>
  );
}

function BulkSettle({
  friend,
  legs,
  onDone,
}: {
  friend: CrossLedgerBalance;
  legs: Contribution[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const total = legs.reduce((a, c) => a + c.amount, 0);

  // One server-side batched write across every contributing ledger, so a bulk settle
  // cannot half-apply (SPEC §11). Guests come back in `skipped` - they have no VPA
  // and are settled by hand - rather than being silently dropped.
  async function record() {
    setBusy(true);
    setStatus("");
    try {
      // The client type in queries.ts has no `total`; the server returns one, and it is what was recorded.
      const res = await api<{ total: number; settlements: unknown[]; skipped: unknown[] }>("/api/settlements/bulk", {
        method: "POST",
        body: JSON.stringify({ toUserId: friend.userId, method: friend.vpa ? "upi" : "manual", note: null }),
      });
      const done = res.settlements.length;
      // Nothing written is not a success. It used to report "recorded" anyway and
      // close the sheet, which is exactly how a settle-up came to be "done" while
      // the balance it was meant to clear sat there unchanged.
      if (done === 0) {
        setStatus(t("balances.recordedNone"));
        return;
      }
      const skipped = res.skipped.length;
      // Only a full success may name the amount: with guest legs skipped, the
      // total would overstate what was actually recorded.
      pushToast(
        skipped === 0
          ? t("balances.recorded", { amount: formatPaise(res.total) })
          : t("balances.recordedSome", { done, total: done + skipped }),
        "success",
      );
      onDone();
    } catch {
      setStatus(t("settle.failed"));
    } finally {
      for (const key of [qk.crossLedger, qk.ledgers]) qc.invalidateQueries({ queryKey: key });
      for (const leg of legs) qc.invalidateQueries({ queryKey: qk.balances(leg.ledgerId) });
      setBusy(false);
    }
  }

  if (legs.length === 0) return <p className="text-[13px]">{t("balances.nothingToSettle")}</p>;

  return (
    <>
      <div className="mb-3">
        <Amount paise={total} label={t("balances.bulkTotal", { name: friend.displayName })} tone="neutral" hero />
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
          {t("balances.contributing")}
        </div>
        <ul>
          {legs.map((c) => (
            <li key={c.ledgerId} className="flex items-center justify-between gap-2.5 py-1">
              <span className="min-w-0 flex-1 truncate text-[15px]">{c.ledgerName}</span>
              <Amount paise={c.amount} label={t("settle.suggested")} tone="neutral" />
            </li>
          ))}
        </ul>
      </div>

      {friend.vpa ? (
        <a
          href={upiLink({ vpa: friend.vpa, name: friend.displayName, paise: total, note: t("app.name") })}
          className="mb-3 inline-flex min-h-11 items-center rounded-[6px] border px-4 text-[14px]"
          style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
        >
          {t("settle.payUpi")}
        </a>
      ) : (
        <p className="mb-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("settle.noVpa", { name: friend.displayName })}
        </p>
      )}

      <p role="status" aria-live="polite" className="mb-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
        {status}
      </p>

      <p className="mb-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
        {t("balances.recordAllHint")}
      </p>
      <Button block disabled={busy} onClick={record}>
        {t("balances.recordAll")}
      </Button>
    </>
  );
}

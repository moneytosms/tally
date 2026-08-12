// Balances tab. SPEC §10: "what do I owe Rahul overall" is a different question
// from "what happened on the Goa trip", so it gets its own tab.
//
// Cross-ledger net per friend on top, per-ledger net positions and transfer plan
// below, every suggested transfer carrying its trail.
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Amount, Avatar, Button, EmptyState, Sheet } from "~/client/components/ui";
import { WhyTrail } from "~/client/components/WhyTrail";
import { paiseToRupeeString } from "~/client/components/SplitEditor";
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

  return (
    <>
      <h1 className="serif mb-3 text-[21px] tracking-[-0.01em]">{t("tabs.balances")}</h1>

      {rows.length === 0 ? (
        <EmptyState title={t("empty.balances")} body={t("balances.emptyBody")} />
      ) : (
        rows.map((f) => {
          // The API returns THEIR position ("positive = that person is owed").
          // Every label and colour in this row is written from the viewer's side,
          // so flip it once, here, rather than at each use.
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
                  <div className="truncate text-[14.5px]">{f.displayName}</div>
                  <Amount paise={mine} label={t("balances.overall")} />
                </div>
              </div>
              {mine < 0 && (
                <Button size="sm" onClick={() => setBulkFor(f)}>
                  {t("balances.settleAcross")}
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
        <p className="mt-2 mb-5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("balances.guestsSkipped")}
        </p>
      )}

      <div className="mx-0.5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
        {t("balances.perLedger")}
      </div>
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
  const name = (id: string) => roster.find((m) => m.id === id)?.nickname ?? t("member.unknown");
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

  return (
    <section className="mb-2 rounded-[7px] border px-3.5 py-3" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="serif truncate text-[16px]">{ledger.name}</h2>
        <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>
          {t("settle.fewestTransfers")}
        </span>
      </div>

      {(balances.data?.positions ?? []).map((p) => (
        <div key={p.memberId} className="flex items-center justify-between gap-2.5 py-1">
          <span className="min-w-0 flex-1 truncate text-[13.5px]">{name(p.memberId)}</span>
          {/* Every row here is a MEMBER's position. Only my own row is spoken in
              the second person; the rest are spoken about the person named. */}
          <Amount
            paise={p.net}
            label={t("ledger.netPosition")}
            subject={p.memberId === myMemberId ? undefined : name(p.memberId)}
          />
        </div>
      ))}

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
        <div className="mb-1 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
          {t("balances.transferPlan")}
        </div>
        {transfers.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            {t("empty.balances")}
          </p>
        ) : (
          transfers.map((tr) => (
            <div key={`${tr.fromMemberId}-${tr.toMemberId}`} className="py-1">
              <div className="flex items-center justify-between gap-2.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {t("settle.pays", { from: name(tr.fromMemberId), to: name(tr.toMemberId) })}
                </span>
                <Amount paise={tr.amount} label={t("settle.suggested")} tone="neutral" />
              </div>
              <WhyTrail ledgerId={ledger.id} fromMemberId={tr.fromMemberId} toMemberId={tr.toMemberId} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function BulkSettle({ friend, legs, onDone }: { friend: CrossLedgerBalance; legs: Contribution[]; onDone: () => void }) {
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
      const res = await api<{ settlements: unknown[]; skipped: unknown[] }>("/api/settlements/bulk", {
        method: "POST",
        body: JSON.stringify({ toUserId: friend.userId, method: friend.vpa ? "upi" : "manual", note: null }),
      });
      const done = res.settlements.length;
      setStatus(t(res.skipped.length === 0 ? "balances.recordedAll" : "balances.recordedSome", { done, total: done + res.skipped.length }));
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
        <div className="mb-1.5 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
          {t("balances.contributing")}
        </div>
        <ul>
          {legs.map((c) => (
            <li key={c.ledgerId} className="flex items-center justify-between gap-2.5 py-1">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.ledgerName}</span>
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
          {t("settle.payUpi", { amount: `₹${paiseToRupeeString(total)}` })}
        </a>
      ) : (
        <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("settle.noVpa", { name: friend.displayName })}
        </p>
      )}

      <p role="status" aria-live="polite" className="mb-2 text-[12px]" style={{ color: "var(--ink-2)" }}>
        {status}
      </p>

      <Button className="w-full" disabled={busy} onClick={record}>
        {t("balances.recordAll")}
      </Button>
    </>
  );
}

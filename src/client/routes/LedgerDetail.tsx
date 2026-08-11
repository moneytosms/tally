import { Link, useNavigate, useParams } from "react-router";
import { Amount, Avatar, Button, EmptyState } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useExpenses, useLedger, useMe, useMembers, type Expense, type Member } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const memberName = (m: Member | undefined) => m?.nickname ?? t("member.unknown");

function ExpenseRow({ expense, payer, myMemberId }: { expense: Expense; payer: Member | undefined; myMemberId?: string }) {
  // A Refund is an Expense with a negative total. It must not read as an expense.
  const isRefund = expense.total < 0;
  const myShare = myMemberId ? expense.splits.find((s) => s.memberId === myMemberId) : undefined;
  return (
    <div
      className="mb-2 rounded-[7px] border px-3.5 py-3"
      style={{
        background: "var(--paper-2)",
        borderColor: "var(--line)",
        borderLeft: isRefund ? "2px solid var(--moss)" : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={memberName(payer)} />
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-medium">
              {expense.description}
              {isRefund && (
                <span
                  className="ml-2 rounded-[5px] border px-1.5 py-0.5 align-middle text-[10.5px] tracking-[0.13em] uppercase"
                  style={{ borderColor: "var(--moss)", background: "var(--moss-wash)", color: "var(--moss-2)" }}
                >
                  {t("expense.refund")}
                </span>
              )}
            </div>
            <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {t(isRefund ? "expense.refundedBy" : "expense.paidByName", { name: memberName(payer) })}
              {" · "}
              {t("expense.splitWays", { count: expense.splits.length })}
            </div>
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <Amount paise={expense.total} label={t("expense.total")} tone="neutral" />
          {myShare && <Amount paise={-myShare.amount} label={t("expense.yourShare")} />}
        </div>
      </div>
    </div>
  );
}

export function LedgerDetail() {
  const { ledgerId = "" } = useParams();
  const navigate = useNavigate();
  const ledger = useLedger(ledgerId);
  const expenses = useExpenses(ledgerId);
  const members = useMembers(ledgerId);
  const me = useMe();

  if (ledger.isPending) return null;
  if (ledger.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));
  const myMemberId = (members.data ?? []).find((m) => m.userId === me.data?.id)?.id;
  const rows = [...(expenses.data ?? [])].sort((a, b) => b.paidAt - a.paidAt);

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link to="/" aria-label={t("action.back")} className={`grid min-h-11 min-w-11 place-items-center text-[17px] ${focusRing}`} style={{ color: "var(--ink-3)" }}>
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="serif truncate text-[21px] tracking-[-0.01em]">{ledger.data.name}</h1>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {t("expense.member", { count: ledger.data.memberCount })}
          </div>
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <Amount paise={ledger.data.net} label={t("ledger.yourPosition")} hero />
        <Button size="sm" onClick={() => navigate(`/ledgers/${ledgerId}/settle`)}>
          {t("settle.title")}
        </Button>
      </div>

      <div className="mx-0.5 mt-1 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
        {t("ledger.expenses")}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("empty.expenses")} body={t("empty.expensesBody")} />
      ) : (
        rows.map((e) => <ExpenseRow key={e.id} expense={e} payer={byId.get(e.payerMemberId)} myMemberId={myMemberId} />)
      )}

      <div className="mx-0.5 mt-5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
        {t("ledger.members")}
      </div>
      <div className="rounded-[7px] border px-3.5 py-2" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        {(members.data ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 py-1.5">
            <Avatar name={m.nickname} />
            <span className="flex-1 truncate text-[14px]">{m.nickname}</span>
            {m.guestName !== null && (
              <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {t("member.guest")}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

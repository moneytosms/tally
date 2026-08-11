import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Amount, Avatar, Button, EmptyState, Field, Input } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { ExpenseSheet } from "~/client/components/ExpenseSheet";
import {
  useCategories,
  useExpenseSearch,
  useExpenses,
  useLedger,
  useMe,
  useMembers,
  type Expense,
  type ExpenseFilters,
  type Member,
} from "~/client/lib/queries";
import { t } from "~/client/i18n";

const memberName = (m: Member | undefined) => m?.nickname ?? t("member.unknown");

const selectClass = `min-h-11 w-full rounded-[6px] border px-3 text-[14px] ${focusRing}`;
const selectStyle = { background: "var(--paper-sunk)", borderColor: "var(--line)", color: "var(--ink)" } as const;

// yyyy-mm-dd <-> epoch ms for native date inputs. `to` is end-of-day so the
// picked day is inclusive.
const dateInputValue = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
const startOfDay = (s: string) => (s ? new Date(`${s}T00:00:00`).getTime() : undefined);
const endOfDay = (s: string) => (s ? new Date(`${s}T23:59:59.999`).getTime() : undefined);

function ExpenseRow({
  expense,
  payer,
  myMemberId,
  onSelect,
}: {
  expense: Expense;
  payer: Member | undefined;
  myMemberId?: string;
  onSelect: (expense: Expense) => void;
}) {
  // A Refund is an Expense with a negative total. It must not read as an expense.
  const isRefund = expense.total < 0;
  const myShare = myMemberId ? expense.splits.find((s) => s.memberId === myMemberId) : undefined;
  return (
    <button
      type="button"
      onClick={() => onSelect(expense)}
      className={`mb-2 block w-full rounded-[7px] border px-3.5 py-3 text-left ${focusRing}`}
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
    </button>
  );
}

export function LedgerDetail() {
  const { ledgerId = "" } = useParams();
  const navigate = useNavigate();
  const ledger = useLedger(ledgerId);
  const members = useMembers(ledgerId);
  const categories = useCategories();
  const me = useMe();

  const [filters, setFilters] = useState<ExpenseFilters>({});
  const [selected, setSelected] = useState<Expense | null>(null);

  // The unfiltered list is kept alongside the filtered one purely so the result
  // count can say "3 of 20" — the server is the only thing that filters.
  const all = useExpenses(ledgerId);
  const expenses = useExpenseSearch(ledgerId, filters);
  const filtering = Object.values(filters).some((v) => v !== undefined && v !== "");

  if (ledger.isPending) return null;
  if (ledger.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));
  const myMemberId = (members.data ?? []).find((m) => m.userId === me.data?.id)?.id;
  const rows = [...(expenses.data ?? [])].sort((a, b) => b.paidAt - a.paidAt);

  const patch = (p: Partial<ExpenseFilters>) => setFilters((f) => ({ ...f, ...p }));

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

      <div className="mx-0.5 mt-1 mb-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
          {t("ledger.expenses")}
        </span>
        <span className="flex items-center gap-3">
          <Link
            to={`/ledgers/${ledgerId}/activity`}
            className={`min-h-11 px-1 text-[12px] underline ${focusRing}`}
            style={{ color: "var(--moss)" }}
          >
            {t("activity.title")}
          </Link>
          <Link
            to={`/ledgers/${ledgerId}/recurring`}
            className={`min-h-11 px-1 text-[12px] underline ${focusRing}`}
            style={{ color: "var(--moss)" }}
          >
            {t("recurring.title")}
          </Link>
        </span>
      </div>

      <div className="mb-3 grid gap-2">
        <Field label={t("search.label")}>
          <Input
            type="search"
            value={filters.q ?? ""}
            placeholder={t("search.placeholder")}
            onChange={(e) => patch({ q: e.target.value || undefined })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("search.category")}>
            <select
              className={selectClass}
              style={selectStyle}
              value={filters.categoryId ?? ""}
              onChange={(e) => patch({ categoryId: e.target.value || undefined })}
            >
              <option value="">{t("search.anyCategory")}</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("search.member")}>
            <select
              className={selectClass}
              style={selectStyle}
              value={filters.memberId ?? ""}
              onChange={(e) => patch({ memberId: e.target.value || undefined })}
            >
              <option value="">{t("search.anyMember")}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("search.from")}>
            <Input
              type="date"
              value={dateInputValue(filters.from)}
              onChange={(e) => patch({ from: startOfDay(e.target.value) })}
            />
          </Field>
          <Field label={t("search.to")}>
            <Input
              type="date"
              value={dateInputValue(filters.to)}
              onChange={(e) => patch({ to: endOfDay(e.target.value) })}
            />
          </Field>
        </div>
        {filtering && (
          <div className="flex items-center justify-between gap-2" role="status" aria-live="polite">
            <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {t("search.results", { count: rows.length, total: all.data?.length ?? rows.length })}
            </span>
            <button
              type="button"
              onClick={() => setFilters({})}
              className={`min-h-11 px-1 text-[12px] underline ${focusRing}`}
              style={{ color: "var(--moss)" }}
            >
              {t("search.clear")}
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        filtering ? (
          <EmptyState title={t("search.none")} body={t("search.clear")} />
        ) : (
          <EmptyState title={t("empty.expenses")} body={t("empty.expensesBody")} />
        )
      ) : (
        rows.map((e) => (
          <ExpenseRow
            key={e.id}
            expense={e}
            payer={byId.get(e.payerMemberId)}
            myMemberId={myMemberId}
            onSelect={setSelected}
          />
        ))
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

      {selected && (
        <ExpenseSheet
          ledgerId={ledgerId}
          expense={selected}
          members={members.data ?? []}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
        />
      )}
    </>
  );
}

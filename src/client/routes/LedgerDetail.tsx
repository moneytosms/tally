import { useState } from "react";
import { useParams } from "react-router";
import { Amount, Button, EmptyState, Field, Input, Select, Skeleton } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { ExpenseSheet } from "~/client/components/ExpenseSheet";
import {
  useCategories,
  useExpenseSearch,
  useExpenses,
  useMe,
  useMembers,
  type Expense,
  type ExpenseFilters,
  type Member,
} from "~/client/lib/queries";
import { t } from "~/client/i18n";

const memberName = (m: Member | undefined) => m?.nickname ?? t("member.unknown");

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export type ExpenseSort = "newest" | "oldest" | "amountHigh" | "amountLow";

const sortComparators: Record<ExpenseSort, (a: Expense, b: Expense) => number> = {
  newest: (a, b) => b.paidAt - a.paidAt,
  oldest: (a, b) => a.paidAt - b.paidAt,
  amountHigh: (a, b) => b.total - a.total,
  amountLow: (a, b) => a.total - b.total,
};

export function sortExpenses(expenses: Expense[], sort: ExpenseSort): Expense[] {
  return [...expenses].sort(sortComparators[sort]);
}

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
  const who = t(isRefund ? "expense.refundedBy" : "expense.paidByName", { name: memberName(payer) });
  return (
    <button
      type="button"
      onClick={() => onSelect(expense)}
      className={`row-in mb-2 block w-full rounded-[7px] border px-3.5 py-3 text-left ${focusRing}`}
      style={{
        background: "var(--paper-2)",
        borderColor: "var(--line)",
        borderLeft: isRefund ? "2px solid var(--moss)" : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">
            {expense.description}
            {isRefund && (
              <span
                className="ml-2 rounded-[5px] border px-1.5 py-0.5 align-middle text-[13px] tracking-[0.13em] uppercase"
                style={{ borderColor: "var(--moss)", background: "var(--moss-wash)", color: "var(--moss-2)" }}
              >
                {t("expense.refund")}
              </span>
            )}
          </div>
          <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("expense.rowMeta", { who, date: dateFmt.format(expense.paidAt) })}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <Amount paise={expense.total} label={t("expense.total")} tone="neutral" />
          {/* A share is a slice of the total, not a balance. Rendering it as a
              position made a solo expense claim "you owe" while the ledger header
              said settled. */}
          {myShare && <Amount paise={myShare.amount} label={t("expense.yourShare")} tone="neutral" />}
        </div>
      </div>
    </button>
  );
}

export function LedgerDetail() {
  const { ledgerId = "" } = useParams();
  const members = useMembers(ledgerId);
  const categories = useCategories();
  const me = useMe();

  const [filters, setFilters] = useState<ExpenseFilters>({});
  const [sort, setSort] = useState<ExpenseSort>("newest");
  // Store the id, not the expense: the detail is read from the list each render, so a restore or edit shows.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // The unfiltered list is kept alongside the filtered one purely so the result
  // count can say "3 of 20" - the server is the only thing that filters.
  const all = useExpenses(ledgerId);
  const expenses = useExpenseSearch(ledgerId, filters);
  const filtering = Object.values(filters).some((v) => v !== undefined && v !== "");
  // If the expense leaves the list (e.g. deleted), the sheet closes.
  const selected = (all.data ?? []).find((e) => e.id === selectedId);

  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));
  const myMemberId = (members.data ?? []).find((m) => m.userId === me.data?.id)?.id;
  const rows = sortExpenses(expenses.data ?? [], sort);

  const patch = (p: Partial<ExpenseFilters>) => setFilters((f) => ({ ...f, ...p }));

  // Check if there are active filters (category, member, from, to) - not including search
  const hasFilterSet =
    filters.categoryId !== undefined ||
    filters.memberId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  return (
    <>
      {(all.data?.length ?? 0) > 1 && (
        <div className="mb-2 flex min-h-11 justify-end">
          <Select
            aria-label={t("sort.label")}
            value={sort}
            onChange={(e) => setSort(e.target.value as ExpenseSort)}
            className="w-auto min-h-11 py-0 text-[13px]"
          >
            <option value="newest">{t("sort.newest")}</option>
            <option value="oldest">{t("sort.oldest")}</option>
            <option value="amountHigh">{t("sort.amountHigh")}</option>
            <option value="amountLow">{t("sort.amountLow")}</option>
          </Select>
        </div>
      )}

      {/* Nothing to filter until there is a list worth filtering, unless a filter is
          already on: then the controls are the only way to clear it. */}
      {((all.data?.length ?? 0) > 0 || filtering) && (
        <div className="mb-3 grid gap-2">
          {/* Collapsible search field - shows as icon when empty/unfocused, expands on tap */}
          {searchExpanded ? (
            <Field label={t("search.label")}>
              <Input
                type="search"
                autoFocus
                value={filters.q ?? ""}
                placeholder={t("search.placeholder")}
                onChange={(e) => patch({ q: e.target.value || undefined })}
                onBlur={() => {
                  // Collapse when blurred and empty
                  if (!filters.q) {
                    setSearchExpanded(false);
                  }
                }}
              />
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setSearchExpanded(true)}
              className={`inline-flex min-h-11 cursor-pointer items-center text-[17px] ${focusRing}`}
              aria-label={t("search.label")}
            >
              🔍
            </button>
          )}

          {/* Collapsible filters section */}
          <div>
            <button
              type="button"
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-expanded={filtersExpanded}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[6px] border px-2.5 text-[13px] ${focusRing}`}
              style={{
                borderColor: hasFilterSet ? "var(--moss)" : "var(--line)",
                color: hasFilterSet ? "var(--moss-2)" : "var(--ink-2)",
                background: hasFilterSet ? "var(--moss-wash)" : "var(--paper-2)",
              }}
            >
              {t("search.filters")}
              {hasFilterSet && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: "var(--moss)" }}
                  aria-hidden="true"
                />
              )}
              <span
                aria-hidden="true"
                className="text-[13px]"
                style={{ transform: filtersExpanded ? "rotate(180deg)" : undefined }}
              >
                ▾
              </span>
            </button>
            {filtersExpanded && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={t("search.category")}>
                  <Select
                    value={filters.categoryId ?? ""}
                    onChange={(e) => patch({ categoryId: e.target.value || undefined })}
                  >
                    <option value="">{t("search.anyCategory")}</option>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("search.member")}>
                  <Select
                    value={filters.memberId ?? ""}
                    onChange={(e) => patch({ memberId: e.target.value || undefined })}
                  >
                    <option value="">{t("search.anyMember")}</option>
                    {(members.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nickname}
                      </option>
                    ))}
                  </Select>
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
            )}
          </div>

          {filtering && (
            <div className="flex items-center justify-between gap-2" role="status" aria-live="polite">
              <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                {t("search.results", { count: rows.length, total: all.data?.length ?? rows.length })}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
                {t("search.clear")}
              </Button>
            </div>
          )}
        </div>
      )}

      {expenses.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[68px] w-full" />
        </div>
      ) : expenses.error ? (
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      ) : rows.length === 0 ? (
        filtering ? (
          <EmptyState title={t("search.none")} />
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
            onSelect={(x) => setSelectedId(x.id)}
          />
        ))
      )}

      {selected && (
        <ExpenseSheet
          ledgerId={ledgerId}
          expense={selected}
          members={members.data ?? []}
          open
          onOpenChange={(o) => !o && setSelectedId(null)}
        />
      )}
    </>
  );
}

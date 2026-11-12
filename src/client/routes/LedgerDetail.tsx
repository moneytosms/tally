import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  Amount,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  Input,
  SearchField,
  Select,
  Skeleton,
} from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { FilterSheet } from "~/client/components/FilterSheet";
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
import { formatDate } from "~/client/lib/format";
import { t } from "~/client/i18n";

const memberName = (m: Member | undefined) => m?.nickname ?? t("member.unknown");

export type ExpenseSort = "newest" | "oldest" | "amountHigh" | "amountLow";
export type ExpenseQuery = ExpenseFilters & { sort: ExpenseSort };

const sortComparators: Record<ExpenseSort, (a: Expense, b: Expense) => number> = {
  newest: (a, b) => b.paidAt - a.paidAt,
  oldest: (a, b) => a.paidAt - b.paidAt,
  amountHigh: (a, b) => b.total - a.total,
  amountLow: (a, b) => a.total - b.total,
};

export function sortExpenses(expenses: Expense[], sort: ExpenseSort): Expense[] {
  return [...expenses].sort(sortComparators[sort]);
}

// Days in the URL are local yyyy-mm-dd. `to` is end-of-day so the picked day is inclusive.
const pad = (n: number) => String(n).padStart(2, "0");
const toDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDay = (value: string | null | undefined, end: boolean): number | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`).getTime();
  // Rejects impossible dates such as 2026-02-31, which Date would silently roll over.
  return Number.isNaN(ms) || toDay(ms) !== value ? undefined : ms;
};

/** Search, filters and sort live in the URL so they survive opening an expense and the Back button. */
export function parseExpenseParams(params: URLSearchParams): ExpenseQuery {
  const sort = params.get("sort") as ExpenseSort;
  return {
    q: params.get("q") || undefined,
    sort: Object.hasOwn(sortComparators, sort) ? sort : "newest",
    categoryId: params.get("category") || undefined,
    memberId: params.get("person") || undefined,
    from: fromDay(params.get("from"), false),
    to: fromDay(params.get("to"), true),
  };
}

export function encodeExpenseParams(query: ExpenseQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.categoryId) params.set("category", query.categoryId);
  if (query.memberId) params.set("person", query.memberId);
  if (query.from !== undefined) params.set("from", toDay(query.from));
  if (query.to !== undefined) params.set("to", toDay(query.to));
  return params;
}

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
    <Card interactive className="row-in mb-2">
      {/* The button fills the card, padding included, so the whole row is the target. */}
      <button
        type="button"
        onClick={() => onSelect(expense)}
        className={`-mx-3.5 -my-3 flex w-[calc(100%+1.75rem)] items-center justify-between gap-2.5 rounded-[7px] px-3.5 py-3 text-left ${focusRing}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-medium">{expense.description}</span>
            {isRefund && <Badge>{t("expense.refund")}</Badge>}
          </div>
          <div className="truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("expense.rowMeta", { who, date: formatDate(expense.paidAt) })}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <Amount paise={expense.total} label={t("expense.total")} tone="neutral" />
          {/* A share is a slice of the total, not a balance. Rendering it as a
              position made a solo expense claim "you owe" while the ledger header
              said settled. */}
          {myShare && <Amount paise={myShare.amount} label={t("expense.yourShare")} tone="neutral" />}
        </div>
      </button>
    </Card>
  );
}

export function LedgerDetail() {
  const { ledgerId = "" } = useParams();
  const members = useMembers(ledgerId);
  const categories = useCategories();
  const me = useMe();

  const [params, setParams] = useSearchParams();
  const { sort, ...filters } = parseExpenseParams(params);
  // Replace, not push: each keystroke or filter change must not add a Back step.
  const update = (change: (query: ExpenseQuery) => ExpenseQuery) =>
    setParams((prev) => encodeExpenseParams(change(parseExpenseParams(prev))), { replace: true });

  // Typing is local; the URL (and the request) follows after a pause.
  const [qInput, setQInput] = useState(filters.q ?? "");
  const qTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(qTimer.current), []);
  const onSearch = (value: string) => {
    setQInput(value);
    clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => update((q) => ({ ...q, q: value || undefined })), 250);
  };
  const clearAll = () => {
    clearTimeout(qTimer.current);
    setQInput("");
    update(() => ({ sort: "newest" }));
  };
  const patch = (p: Partial<ExpenseQuery>) => update((q) => ({ ...q, ...p }));

  const [sheetOpen, setSheetOpen] = useState(false);
  // Store the id, not the expense: the detail is read from the list each render, so a restore or edit shows.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The unfiltered list is kept alongside the filtered one purely so the result
  // count can say "3 of 20" - the server is the only thing that filters.
  const all = useExpenses(ledgerId);
  const expenses = useExpenseSearch(ledgerId, filters);
  // If the expense leaves the list (e.g. deleted), the sheet closes.
  const selected = (all.data ?? []).find((e) => e.id === selectedId);

  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));
  const myMemberId = (members.data ?? []).find((m) => m.userId === me.data?.id)?.id;
  const rows = sortExpenses(expenses.data ?? [], sort);

  // Search is not a filter: it is shown in the field, not as a chip or in the count.
  const filterCount =
    [filters.categoryId, filters.memberId, filters.from, filters.to].filter((v) => v !== undefined).length +
    (sort !== "newest" ? 1 : 0);
  const applied = filterCount > 0 || Boolean(filters.q);
  const showToolbar = (all.data?.length ?? 0) > 0 || applied;

  const category = (categories.data ?? []).find((c) => c.id === filters.categoryId);
  const member = (members.data ?? []).find((m) => m.id === filters.memberId);
  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...(category ? [{ key: "category", label: category.name, onRemove: () => patch({ categoryId: undefined }) }] : []),
    ...(member ? [{ key: "member", label: memberName(member), onRemove: () => patch({ memberId: undefined }) }] : []),
    ...(filters.from !== undefined
      ? [
          {
            key: "from",
            label: t("search.chipFrom", { date: formatDate(filters.from) }),
            onRemove: () => patch({ from: undefined }),
          },
        ]
      : []),
    ...(filters.to !== undefined
      ? [
          {
            key: "to",
            label: t("search.chipTo", { date: formatDate(filters.to) }),
            onRemove: () => patch({ to: undefined }),
          },
        ]
      : []),
    ...(sort !== "newest"
      ? [{ key: "sort", label: t(`sort.${sort}`), onRemove: () => patch({ sort: "newest" }) }]
      : []),
  ];

  return (
    <>
      {showToolbar && (
        <div className="sticky top-0 z-10 pb-2" style={{ background: "var(--paper)" }}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchField
                value={qInput}
                onChange={onSearch}
                label={t("search.label")}
                placeholder={t("search.placeholder")}
              />
            </div>
            <IconButton icon="filter" label={t("filter.open")} badge={filterCount} onClick={() => setSheetOpen(true)} />
          </div>
        </div>
      )}

      {showToolbar && applied && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <FilterChip key={c.key} removeLabel={t("filter.remove", { name: c.label })} onRemove={c.onRemove}>
              {c.label}
            </FilterChip>
          ))}
          <span className="text-[13px]" style={{ color: "var(--ink-3)" }} role="status" aria-live="polite">
            {t("search.results", { count: rows.length, total: all.data?.length ?? rows.length })}
            {expenses.isFetching && !expenses.isPending && ` · ${t("search.updating")}`}
          </span>
        </div>
      )}

      {expenses.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[68px] w-full" />
        </div>
      ) : expenses.error ? (
        <EmptyState
          title={t("error.generic")}
          body={t("error.network")}
          action={
            <Button size="sm" variant="ghost" onClick={() => expenses.refetch()}>
              {t("action.retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        applied ? (
          <EmptyState
            title={t("search.none")}
            action={
              <Button size="sm" variant="ghost" onClick={clearAll}>
                {t("filter.clearAll")}
              </Button>
            }
          />
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

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("filter.title")}
        showLabel={t("filter.showExpenses", { count: rows.length })}
        onClear={clearAll}
      >
        <Field label={t("sort.label")}>
          <Select value={sort} onChange={(e) => patch({ sort: e.target.value as ExpenseSort })}>
            <option value="newest">{t("sort.newest")}</option>
            <option value="oldest">{t("sort.oldest")}</option>
            <option value="amountHigh">{t("sort.amountHigh")}</option>
            <option value="amountLow">{t("sort.amountLow")}</option>
          </Select>
        </Field>
        <Field label={t("search.category")}>
          <Select value={filters.categoryId ?? ""} onChange={(e) => patch({ categoryId: e.target.value || undefined })}>
            <option value="">{t("search.anyCategory")}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("search.member")}>
          <Select value={filters.memberId ?? ""} onChange={(e) => patch({ memberId: e.target.value || undefined })}>
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
            value={filters.from !== undefined ? toDay(filters.from) : ""}
            onChange={(e) => patch({ from: fromDay(e.target.value, false) })}
          />
        </Field>
        <Field label={t("search.to")}>
          <Input
            type="date"
            value={filters.to !== undefined ? toDay(filters.to) : ""}
            onChange={(e) => patch({ to: fromDay(e.target.value, true) })}
          />
        </Field>
      </FilterSheet>

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

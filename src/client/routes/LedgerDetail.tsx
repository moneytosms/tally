import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Amount, Avatar, Button, EmptyState, Field, Input, ScreenSkeleton, Select } from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { ExpenseSheet } from "~/client/components/ExpenseSheet";
import { BurnRate, runFor } from "~/client/routes/LedgersTab";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "~/client/lib/api";
import {
  qk,
  useCategories,
  useCreateInvite,
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

// Lazy for the same reason App.tsx keeps it lazy - it pulls in the split editor.
const ExpenseForm = lazy(() => import("~/client/routes/ExpenseForm"));

const memberName = (m: Member | undefined) => m?.nickname ?? t("member.unknown");


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
          {/* A share is a slice of the total, not a balance. Rendering it as a
              position made a solo expense claim "you owe" while the ledger header
              said settled. */}
          {myShare && <Amount paise={myShare.amount} label={t("expense.yourShare")} tone="neutral" />}
        </div>
      </div>
    </button>
  );
}

/** Creates a single-use, 48-hour invite link for this ledger.
 *  The server returns the token ONCE. It is held in component state only -
 *  navigating away loses it and a new invite must be minted, which is correct:
 *  an invite is a bearer credential, so it is never re-fetchable. */
function InviteRow({ ledgerId }: { ledgerId: string }) {
  const create = useCreateInvite(ledgerId);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = () =>
    create.mutate(undefined, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}/welcome?invite=${encodeURIComponent(token)}`);
        setCopied(false);
      },
    });

  return (
    <div className="mt-1 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
      {link === null ? (
        <>
          <Button variant="ghost" size="sm" disabled={create.isPending} onClick={mint}>
            {t("ledger.invite")}
          </Button>
          {create.isError && (
            <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--clay)" }}>
              {t("error.generic")}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mb-1.5 rounded-[6px] border px-2.5 py-2 text-[11.5px] break-all" style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}>
            {link}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
            >
              {t(copied ? "ledger.inviteCopied" : "ledger.inviteCopy")}
            </Button>
          </div>
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            {t("ledger.inviteHint")}
          </p>
        </>
      )}
    </div>
  );
}

/** Adds an EXISTING user straight to the ledger - no invite round-trip. Any
 *  member may, exactly as any member may mint an invite (ADR 0005).
 *
 *  The candidates carry a display name and nothing else: a VPA is visible only
 *  to co-members, and these people are not co-members yet. */
function AddExistingMember({ ledgerId }: { ledgerId: string }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState("");
  const [added, setAdded] = useState("");

  const addable = useQuery({
    queryKey: [...qk.members(ledgerId), "addable"],
    queryFn: () => api<Array<{ id: string; displayName: string }>>(`/api/ledgers/${ledgerId}/addable-users`),
  });

  const add = useMutation({
    mutationFn: (userId: string) =>
      api<Member>(`/api/ledgers/${ledgerId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: (member) => {
      setAdded(t("member.addExistingDone", { name: member.nickname }));
      setPicked("");
      qc.invalidateQueries({ queryKey: qk.members(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledger(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });

  const candidates = addable.data ?? [];

  return (
    <div className="mt-1 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
      <div className="mb-1.5 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
        {t("member.addExisting")}
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("member.addExistingNone")}
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <span className="min-w-0 flex-1">
            <Field label={t("member.pick")}>
              <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">{t("member.pick")}</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          </span>
          <Button
            size="sm"
            className="mb-3"
            disabled={!picked || add.isPending}
            onClick={() => {
              setAdded("");
              add.mutate(picked);
            }}
          >
            {t("member.addExistingAction")}
          </Button>
        </div>
      )}
      <p className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("member.addExistingHint")}
      </p>
      <p role="status" aria-live="polite" className="mt-1.5 text-[11.5px]" style={{ color: add.isError ? "var(--clay)" : "var(--moss-2)" }}>
        {add.isError ? t("member.addExistingFailed") : added}
      </p>
    </div>
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
  const [adding, setAdding] = useState(false);

  // The unfiltered list is kept alongside the filtered one purely so the result
  // count can say "3 of 20" - the server is the only thing that filters.
  const all = useExpenses(ledgerId);
  const expenses = useExpenseSearch(ledgerId, filters);
  const filtering = Object.values(filters).some((v) => v !== undefined && v !== "");

  if (ledger.isPending) return <ScreenSkeleton />;
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
            {" · "}
            {runFor(ledger.data.endDate)}
          </div>
        </div>
      </header>

      <div className="mb-4 rounded-[7px] border px-3.5 py-4" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <div className="flex items-center justify-between gap-3">
          <Amount paise={ledger.data.net} label={t("ledger.yourPosition")} hero />
          <span className="flex shrink-0 gap-2">
            {/* The FAB already defaults to this ledger, but the action is worth
                naming where the expenses actually are. */}
            <Button size="sm" onClick={() => setAdding(true)}>
              {t("expense.add")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate(`/ledgers/${ledgerId}/settle`)}>
              {t("settle.title")}
            </Button>
          </span>
        </div>
        {/* A budget entered at creation used to be stored and never shown again. */}
        <BurnRate ledger={ledger.data} />
      </div>

      <Sheet open={adding} onOpenChange={setAdding} title={t("expense.add")}>
        <Suspense fallback={null}>
          <ExpenseForm onDone={() => setAdding(false)} />
        </Suspense>
      </Sheet>

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

      {/* Nothing to filter until there is a list worth filtering. Five controls
          above an empty state is furniture, not help. */}
      {(all.data?.length ?? 0) > 0 && (
      <div className="mb-3 grid gap-2">
        <Field label={t("search.label")}>
          <Input
            type="search"
            value={filters.q ?? ""}
            placeholder={t("search.placeholder")}
            onChange={(e) => patch({ q: e.target.value || undefined })}
          />
        </Field>
        <details>
          <summary
            className={`inline-flex min-h-11 cursor-pointer list-none items-center text-[12px] underline ${focusRing}`}
            style={{ color: "var(--moss)" }}
          >
            {t("search.filters")}
          </summary>
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
        </details>
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
      )}

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
        <AddExistingMember ledgerId={ledgerId} />
        <InviteRow ledgerId={ledgerId} />
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

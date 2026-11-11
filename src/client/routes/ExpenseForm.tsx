// Add or edit an expense. SPEC §10: category chips up front, structured form,
// always visible, never behind a toggle. The natural-language quick-add line
// (issue #33) is gone - its grammar was never specified (SPEC §13) and it
// mostly got in the way rather than saving taps.
//
// One form, two modes: pass `expense` and it PATCHes instead of POSTing. A
// second copy of this file would be a second place for the rounding rule and
// the split validation to drift.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Button, Field, Input, Rupees, Select, pushToast } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import {
  SplitEditor,
  paiseToRupeeString,
  preview,
  remainingToAllocate,
  rupeesToPaise,
  splitValues,
  type SplitParticipant,
} from "~/client/components/SplitEditor";
import { ParticipantPicker } from "~/client/components/ParticipantPicker";
import {
  useCategories,
  useCreateExpense,
  useLedgers,
  useMe,
  useMembers,
  useUpdateExpense,
  type Expense,
} from "~/client/lib/queries";
import { ApiError } from "~/client/lib/api";
import { t } from "~/client/i18n";
import { formatPaise, type Paise, type SplitMode } from "~/shared/money";

/** A stored expense as the editor needs it: the wire carries each split's raw
 *  `inputValue` so the form reopens exactly as the user left it. Splits are
 *  STORED resolved - nothing here recomputes an amount from a weight. */
export type EditableExpense = Omit<Expense, "splits"> & {
  splits: Array<{ memberId: string; amount: Paise; inputValue: number | null }>;
};

/** Local calendar day, not UTC - an expense added at 1am is still today's. */
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const dayOf = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Stored input values back into the text the editor showed. Only the modes that
 *  have per-participant input; `equal` has none. */
function rawFromSplits(expense: EditableExpense): Record<string, string> {
  if (expense.mode === "equal") return {};
  return Object.fromEntries(
    expense.splits.map((s) => [
      s.memberId,
      s.inputValue === null ? "" : expense.mode === "exact" ? paiseToRupeeString(s.inputValue) : String(s.inputValue),
    ]),
  );
}

export default function ExpenseForm({
  onDone,
  expense,
  ledgerId: ledgerIdProp,
}: {
  onDone: () => void;
  expense?: EditableExpense;
  /** The ledger this form belongs to, when opened from inside one. The app-wide
   *  sheet sits outside the ledger route, so it cannot read the id from params. */
  ledgerId?: string;
}) {
  const params = useParams();
  const ledgers = useLedgers();
  const me = useMe();
  const routeLedgerId = ledgerIdProp ?? params.ledgerId;
  // An archived ledger takes no new expenses, so it is never offered.
  const activeLedgers = (ledgers.data ?? []).filter((l) => l.archivedAt === null);

  const [pickedLedger, setPickedLedger] = useState("");
  const ledgerId = expense?.ledgerId || pickedLedger || routeLedgerId || activeLedgers[0]?.id || "";

  const members = useMembers(ledgerId);
  const categories = useCategories();
  const create = useCreateExpense(ledgerId);
  const update = useUpdateExpense(ledgerId, expense?.id ?? "");
  const save = expense ? update : create;

  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountRaw, setAmountRaw] = useState(expense ? paiseToRupeeString(expense.total) : "");
  const [date, setDate] = useState(expense ? dayOf(expense.paidAt) : todayLocal);
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [payerId, setPayerId] = useState(expense?.payerMemberId ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>(expense?.splits.map((s) => s.memberId) ?? []);
  const [categoryId, setCategoryId] = useState<string | null>(expense?.categoryId ?? null);
  const [mode, setMode] = useState<SplitMode>(expense?.mode ?? "equal");
  const [raw, setRaw] = useState<Record<string, string>>(expense ? rawFromSplits(expense) : {});
  // Open when editing: an expense being corrected is likelier to be one whose
  // date is the thing that was wrong.
  const [showDetails, setShowDetails] = useState(Boolean(expense));
  const [failure, setFailure] = useState("");
  // Any edit makes the last save error stale: drop it so it does not outlive the fix.
  const touch = () => setFailure("");

  const roster = useMemo(() => (members.data ?? []).filter((m) => m.leftAt === null), [members.data]);
  const rosterKey = roster.map((m) => m.id).join(",");

  // Everyone in, in member order; that becomes the stable order rounding depends on.
  // Seeded once per ledger (and again once the user's own id is known, so the payer
  // lands on them). A later roster change only drops people who left: it must not
  // re-add deselected people or wipe what was typed. Editing has its stored splits.
  const seededFor = useRef("");
  useEffect(() => {
    if (expense || roster.length === 0) return;
    const ids = new Set(roster.map((m) => m.id));
    const defaultPayer = roster.find((m) => m.userId === me.data?.id)?.id ?? roster[0]?.id ?? "";
    const key = `${ledgerId}|${me.data?.id ?? ""}`;
    if (seededFor.current !== key) {
      seededFor.current = key;
      setParticipantIds(roster.map((m) => m.id));
      setRaw({});
      setPayerId(defaultPayer);
      return;
    }
    setParticipantIds((prev) => prev.filter((id) => ids.has(id)));
    setRaw((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
    setPayerId((prev) => (ids.has(prev) ? prev : defaultPayer));
  }, [rosterKey, ledgerId, me.data?.id, expense]);

  const byId = new Map(roster.map((m) => [m.id, m]));
  const participants: SplitParticipant[] = participantIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ memberId: id, name: m.nickname }] : [];
  });

  const total = rupeesToPaise(amountRaw);
  const payerIndex = participants.findIndex((p) => p.memberId === payerId);
  const result = preview({ total: total ?? 0, mode, payerIndex, participants, raw });
  const remaining = remainingToAllocate({ total: total ?? 0, mode, payerIndex, participants, raw });
  const blocked = !description.trim() || !date || total === null || total === 0 || "error" in result || save.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || total === null) return;
    setFailure("");
    const values = splitValues(mode, participants, raw);
    try {
      await save.mutateAsync({
        description: description.trim(),
        total,
        paidAtEpochMs: new Date(`${date}T00:00`).getTime(),
        categoryId,
        notes: notes.trim() || null,
        payerMemberId: payerId,
        mode,
        participants: participants.map((p, i) => ({ memberId: p.memberId, value: values?.[i] })),
      });
      pushToast(t(expense ? "expense.saved" : "expense.added"), "success");
      onDone();
    } catch (err) {
      // Offline writes fail here and say so. Nothing is queued.
      setFailure(
        err instanceof ApiError && err.code === "offline"
          ? t("offline.body")
          : t(expense ? "expense.editFailed" : "expense.saveFailed"),
      );
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {/* Opened from inside a ledger, the answer is already known. The picker is
          only worth asking for when the form was opened from the FAB. */}
      {!routeLedgerId && (
        <Field label={t("expense.ledger")}>
          <Select
            value={ledgerId}
            onChange={(e) => {
              touch();
              setPickedLedger(e.target.value);
            }}
          >
            {activeLedgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {/* Amount first: it is the one field nobody can skip, and it is what the
          per-head line below reacts to. Description second - a name is easier to
          recall once the number is on screen. */}
      <Field
        label={t("expense.amount")}
        error={amountRaw.trim() && total === null ? t("expense.error.amount") : undefined}
      >
        {/* The ₹ is in the control now, so the "in rupees" caption is redundant. */}
        {/* Inline style, not a class: the Input base class sets text-[16px] and
            the cascade order between two text-size utilities is not guaranteed. */}
        <Rupees
          value={amountRaw}
          onChange={(v) => {
            touch();
            setAmountRaw(v);
          }}
          autoFocus
          style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}
          className="serif"
        />
      </Field>

      <Field label={t("expense.description")}>
        <Input
          value={description}
          onChange={(e) => {
            touch();
            setDescription(e.target.value);
          }}
          autoComplete="off"
        />
      </Field>

      {/* Always visible, never behind a toggle (SPEC §10) - the category Select
          this replaced lived behind "more details" and mostly went unset. A
          tappable chip is one tap instead of a dropdown open-scroll-pick. */}
      <div className="mb-3">
        <span className="mb-1.5 block text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("expense.category")}
        </span>
        <ul className="no-scrollbar -mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1">
          {[{ id: null, name: t("expense.categoryNone"), icon: "—" }, ...(categories.data ?? [])].map((c) => {
            const on = categoryId === c.id;
            const key = c.id ?? "none";
            return (
              <li key={key} className="snap-start">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    touch();
                    setCategoryId(c.id);
                  }}
                  className={`flex min-w-18 flex-col items-center gap-1 rounded-[8px] border px-2 py-2 whitespace-nowrap ${focusRing}`}
                  style={{
                    background: on ? "var(--moss-wash)" : "transparent",
                    borderColor: on ? "var(--moss)" : "var(--line)",
                    opacity: on ? 1 : 0.7,
                  }}
                >
                  <span className="text-[20px] leading-none">{c.icon}</span>
                  <span className="text-center text-[13px]" style={{ color: on ? "var(--ink)" : "var(--ink-3)" }}>
                    {c.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <Field label={t("expense.paidBy")}>
        <Select
          value={payerId}
          onChange={(e) => {
            touch();
            setPayerId(e.target.value);
          }}
        >
          {roster.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nickname}
            </option>
          ))}
        </Select>
      </Field>

      <div className="mb-3">
        <ParticipantPicker
          members={roster.map((m) => ({ id: m.id, name: m.nickname }))}
          selectedIds={participantIds}
          onChange={(ids) => {
            touch();
            setParticipantIds(ids);
            // Values belong to the people who were in the split. Keeping a
            // dropped person's number around means it silently reappears if
            // they are added back, which is not what "I removed them" meant.
            setRaw((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.includes(id))));
          }}
        />
      </div>

      <SplitEditor
        total={total ?? 0}
        mode={mode}
        payerIndex={payerIndex}
        participants={participants}
        raw={raw}
        onModeChange={(m) => {
          touch();
          setMode(m);
        }}
        onRawChange={(r) => {
          touch();
          setRaw(r);
        }}
      />

      {/* Display-only: does not gate save (issue #37) - `blocked` above still owns
          that via `result`. Disappears the instant allocation matches the total. */}
      {remaining && (
        <p
          role="status"
          className="mb-3 text-[13px]"
          style={{ color: remaining.amount < 0 ? "var(--clay)" : "var(--ink-2)" }}
        >
          {t(remaining.amount < 0 ? "expense.overAllocated" : "expense.remainingToAllocate", {
            amount:
              remaining.unit === "percent" ? `${Math.abs(remaining.amount)}%` : formatPaise(Math.abs(remaining.amount)),
          })}
        </p>
      )}

      {/* Date and notes are right nearly every time - today, nothing to add.
          Category moved out to a chip row above (SPEC §10); these two stay
          behind one tap since they cost nothing there. */}
      <div className="mb-3">
        <Button variant="ghost" size="sm" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
          {t(showDetails ? "expense.lessDetails" : "expense.moreDetails")}
        </Button>

        {showDetails && (
          <div className="mt-1.5">
            <Field label={t("expense.date")}>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  touch();
                  setDate(e.target.value);
                }}
              />
            </Field>

            <Field label={t("expense.notes")}>
              <Input
                value={notes}
                onChange={(e) => {
                  touch();
                  setNotes(e.target.value);
                }}
              />
            </Field>
          </div>
        )}
      </div>

      <p role="alert" aria-live="assertive" className="mb-2 text-[13px]" style={{ color: "var(--clay)" }}>
        {failure}
      </p>

      {/* Sticky: this form is taller than a phone screen, and a Save button below
          the fold from the moment the sheet opens is a Save button nobody finds. */}
      <div className="pad-safe-bottom sticky bottom-0 -mx-4 px-4 pt-2 pb-2" style={{ background: "var(--paper)" }}>
        <Button type="submit" disabled={blocked} isLoading={save.isPending} block>
          {t(expense ? "expense.editSave" : "expense.add")}
        </Button>
      </div>
    </form>
  );
}

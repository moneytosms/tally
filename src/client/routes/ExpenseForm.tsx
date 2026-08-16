// Add or edit an expense. SPEC §10: natural-language line first, structured form
// directly beneath, always visible, never behind a toggle.
//
// The parser's grammar is explicitly undecided (SPEC §13), so the line renders
// disabled with a caption. The structured form below it is the whole feature.
//
// One form, two modes: pass `expense` and it PATCHes instead of POSTing. A
// second copy of this file would be a second place for the rounding rule and
// the split validation to drift.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Button, Field, Input, Rupees, Select } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import {
  SplitEditor,
  paiseToRupeeString,
  preview,
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
import { parseExpenseLine } from "~/shared/nl";
import type { Paise, SplitMode } from "~/shared/money";

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

export default function ExpenseForm({ onDone, expense }: { onDone: () => void; expense?: EditableExpense }) {
  const params = useParams();
  const ledgers = useLedgers();
  const me = useMe();

  const [pickedLedger, setPickedLedger] = useState("");
  const ledgerId = expense?.ledgerId || pickedLedger || params.ledgerId || ledgers.data?.[0]?.id || "";

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
  // date or category is the thing that was wrong.
  const [showDetails, setShowDetails] = useState(Boolean(expense));
  const [failure, setFailure] = useState("");
  const [nlText, setNlText] = useState("");
  const [nlUnmatched, setNlUnmatched] = useState<string[]>([]);

  const roster = useMemo(() => (members.data ?? []).filter((m) => m.leftAt === null), [members.data]);
  const rosterKey = roster.map((m) => m.id).join(",");

  // Everyone in, in member order; that becomes the stable order rounding depends on.
  // Editing already has a stable order - the stored splits - so this default,
  // which fires again whenever the roster loads, must not run over it.
  useEffect(() => {
    if (expense) return;
    setParticipantIds(roster.map((m) => m.id));
    setRaw({});
    setPayerId(roster.find((m) => m.userId === me.data?.id)?.id ?? roster[0]?.id ?? "");
  }, [rosterKey, me.data?.id, expense]);

  // Parses as the user types; applies only the fields the parser actually
  // resolved so it assists hand-typed input instead of clobbering it.
  function handleNlChange(text: string) {
    setNlText(text);
    const parse = parseExpenseLine(
      text,
      roster.map((m) => ({ id: m.id, name: m.nickname })),
    );
    setNlUnmatched(parse.unmatched);
    if (parse.total !== null) setAmountRaw(paiseToRupeeString(parse.total));
    if (parse.description !== "") setDescription(parse.description);
    if (parse.payerId !== null) setPayerId(parse.payerId);
    if (parse.participantIds.length > 0) {
      setParticipantIds((ids) => [...ids, ...parse.participantIds.filter((id) => !ids.includes(id))]);
    }
  }

  // The example has to be typable ON THIS LEDGER. The old hardcoded one named
  // people who were never members, so following it produced "could not match".
  const example = useMemo(() => {
    const names = roster.flatMap((m) => {
      const first = m.nickname.trim().toLowerCase().split(/\s+/)[0];
      return first ? [first] : [];
    });
    const [a, b] = names;
    if (a && b) return t("nl.exampleTwo", { a, b });
    if (a) return t("nl.exampleOne", { a });
    return t("nl.exampleBare");
  }, [rosterKey]);

  const byId = new Map(roster.map((m) => [m.id, m]));
  const participants: SplitParticipant[] = participantIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ memberId: id, name: m.nickname }] : [];
  });

  const total = rupeesToPaise(amountRaw);
  const payerIndex = participants.findIndex((p) => p.memberId === payerId);
  const result = preview({ total: total ?? 0, mode, payerIndex, participants, raw });
  const blocked = !description.trim() || total === null || total === 0 || "error" in result || save.isPending;

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
      {/* The line composes a NEW expense from nothing. On an edit it would
          overwrite fields that are already correct, so it isn't offered. */}
      {!expense && (
        <Field label={t("expense.naturalLanguage")}>
          <Input
            value={nlText}
            onChange={(e) => handleNlChange(e.target.value)}
            placeholder={example}
            autoComplete="off"
          />
          {/* The placeholder IS the example; a caption repeating it verbatim was
              just a second line saying the same thing. */}
          <p role="status" aria-live="polite" className="mt-1.5 block text-[11px]" style={{ color: "var(--clay)" }}>
            {nlUnmatched.length > 0 ? t("nl.unmatched", { names: nlUnmatched.join(", ") }) : ""}
          </p>
        </Field>
      )}

      {/* Opened from inside a ledger, the answer is already known. The picker is
          only worth asking for when the form was opened from the FAB. */}
      {!params.ledgerId && (
        <Field label={t("expense.ledger")}>
          <Select value={ledgerId} onChange={(e) => setPickedLedger(e.target.value)}>
            {(ledgers.data ?? []).map((l) => (
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
        <Rupees value={amountRaw} onChange={setAmountRaw} autoFocus />
      </Field>

      <Field label={t("expense.description")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
      </Field>

      <Field label={t("expense.paidBy")}>
        <Select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
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
        onModeChange={setMode}
        onRawChange={setRaw}
      />

      {/* Date, category and notes are right nearly every time - today,
          uncategorised, nothing to add. Behind one tap they cost nothing; in the
          main flow they are three fields between the amount and Save. */}
      <div className="mb-3">
        <button
          type="button"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((v) => !v)}
          className={`min-h-11 rounded-[6px] px-1 text-[13px] ${focusRing}`}
          style={{ color: "var(--moss-2)" }}
        >
          {t(showDetails ? "expense.lessDetails" : "expense.moreDetails")}
        </button>

        {showDetails && (
          <div className="mt-1.5">
            <Field label={t("expense.date")}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>

            <Field label={t("expense.category")}>
              <Select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)}>
                <option value="">{t("expense.categoryNone")}</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("expense.notes")}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <p role="alert" aria-live="assertive" className="mb-2 text-[12px]" style={{ color: "var(--clay)" }}>
        {failure}
      </p>

      {/* Sticky: this form is taller than a phone screen, and a Save button below
          the fold from the moment the sheet opens is a Save button nobody finds. */}
      <div className="pad-safe-bottom sticky bottom-0 -mx-4 px-4 pt-2 pb-2" style={{ background: "var(--paper)" }}>
        <Button type="submit" disabled={blocked} className="w-full">
          {t(expense ? "expense.editSave" : "expense.save")}
        </Button>
      </div>
    </form>
  );
}

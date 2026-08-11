// Add expense. SPEC §10: natural-language line first, structured form directly
// beneath, always visible, never behind a toggle.
//
// The parser's grammar is explicitly undecided (SPEC §13), so the line renders
// disabled with a caption. The structured form below it is the whole feature.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Button, Field, Input } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import {
  SplitEditor,
  paiseToRupeeString,
  preview,
  rupeesToPaise,
  splitValues,
  type SplitParticipant,
} from "~/client/components/SplitEditor";
import { useCategories, useCreateExpense, useLedgers, useMe, useMembers } from "~/client/lib/queries";
import { ApiError } from "~/client/lib/api";
import { t } from "~/client/i18n";
import { parseExpenseLine } from "~/shared/nl";
import type { SplitMode } from "~/shared/money";

const selectClass = `min-h-11 w-full rounded-[6px] border px-3 text-[14px] ${focusRing}`;
const selectStyle = { background: "var(--paper-sunk)", borderColor: "var(--line)", color: "var(--ink)" };

/** Local calendar day, not UTC — an expense added at 1am is still today's. */
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export default function ExpenseForm({ onDone }: { onDone: () => void }) {
  const params = useParams();
  const ledgers = useLedgers();
  const me = useMe();

  const [pickedLedger, setPickedLedger] = useState("");
  const ledgerId = pickedLedger || params.ledgerId || ledgers.data?.[0]?.id || "";

  const members = useMembers(ledgerId);
  const categories = useCategories();
  const create = useCreateExpense(ledgerId);

  const [description, setDescription] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [notes, setNotes] = useState("");
  const [payerId, setPayerId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [mode, setMode] = useState<SplitMode>("equal");
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [nlText, setNlText] = useState("");
  const [nlUnmatched, setNlUnmatched] = useState<string[]>([]);

  const roster = useMemo(() => (members.data ?? []).filter((m) => m.leftAt === null), [members.data]);
  const rosterKey = roster.map((m) => m.id).join(",");

  // Everyone in, in member order; that becomes the stable order rounding depends on.
  useEffect(() => {
    setParticipantIds(roster.map((m) => m.id));
    setRaw({});
    setPayerId(roster.find((m) => m.userId === me.data?.id)?.id ?? roster[0]?.id ?? "");
  }, [rosterKey, me.data?.id]);

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

  const byId = new Map(roster.map((m) => [m.id, m]));
  const participants: SplitParticipant[] = participantIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ memberId: id, name: m.nickname }] : [];
  });
  const absent = roster.filter((m) => !participantIds.includes(m.id));

  const total = rupeesToPaise(amountRaw);
  const payerIndex = participants.findIndex((p) => p.memberId === payerId);
  const result = preview({ total: total ?? 0, mode, payerIndex, participants, raw });
  const blocked = !description.trim() || total === null || total === 0 || "error" in result || create.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || total === null) return;
    setFailure("");
    const values = splitValues(mode, participants, raw);
    try {
      await create.mutateAsync({
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
      setFailure(err instanceof ApiError && err.code === "offline" ? t("offline.body") : t("expense.saveFailed"));
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label={t("expense.naturalLanguage")}>
        <Input
          value={nlText}
          onChange={(e) => handleNlChange(e.target.value)}
          placeholder={t("expense.naturalLanguagePlaceholder")}
          autoComplete="off"
        />
        <span className="mt-1.5 block text-[11px]" style={{ color: "var(--ink-3)" }}>
          {t("nl.hint")}
        </span>
        <p role="status" aria-live="polite" className="mt-1.5 block text-[11px]" style={{ color: "var(--clay)" }}>
          {nlUnmatched.length > 0 ? t("nl.unmatched", { names: nlUnmatched.join(", ") }) : ""}
        </p>
      </Field>

      <Field label={t("expense.ledger")}>
        <select className={selectClass} style={selectStyle} value={ledgerId} onChange={(e) => setPickedLedger(e.target.value)}>
          {(ledgers.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("expense.description")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
      </Field>

      <Field
        label={t("expense.amount")}
        error={amountRaw.trim() && total === null ? t("expense.error.amount") : undefined}
      >
        <Input inputMode="decimal" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="0.00" />
        <span className="mt-1.5 block text-[11px]" style={{ color: "var(--ink-3)" }}>
          {t("expense.amountHint")}
        </span>
      </Field>

      <Field label={t("expense.date")}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label={t("expense.paidBy")}>
        <select className={selectClass} style={selectStyle} value={payerId} onChange={(e) => setPayerId(e.target.value)}>
          {roster.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nickname}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("expense.category")}>
        <select
          className={selectClass}
          style={selectStyle}
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value || null)}
        >
          <option value="">{t("expense.categoryNone")}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("expense.notes")}>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <SplitEditor
        total={total ?? 0}
        mode={mode}
        payerIndex={payerIndex}
        participants={participants}
        raw={raw}
        onModeChange={setMode}
        onRawChange={setRaw}
        onRemove={(id) => setParticipantIds((ids) => ids.filter((x) => x !== id))}
      />

      {absent.length > 0 && (
        <Field label={t("expense.addParticipant")}>
          <select
            className={selectClass}
            style={selectStyle}
            value=""
            onChange={(e) => e.target.value && setParticipantIds((ids) => [...ids, e.target.value])}
          >
            <option value="">{t("expense.addParticipantHint")}</option>
            {absent.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </select>
        </Field>
      )}

      <p role="alert" aria-live="assertive" className="mb-2 text-[12px]" style={{ color: "var(--clay)" }}>
        {failure}
      </p>

      <Button type="submit" disabled={blocked} className="w-full">
        {t("expense.save")}
      </Button>
    </form>
  );
}

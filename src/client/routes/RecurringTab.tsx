// Recurring series: an expense template plus a cadence. List + create/edit sheet.
// The split UI is SplitEditor's job — this file only collects cadence + dates.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Amount, Avatar, Button, EmptyState, Field, Input, Sheet } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import {
  SplitEditor,
  paiseToRupeeString,
  preview,
  rupeesToPaise,
  splitValues,
  type SplitParticipant,
} from "~/client/components/SplitEditor";
import { useCategories, useMembers, useSaveSeries, useSeries, useSeriesAction, type Series } from "~/client/lib/queries";
import { ApiError } from "~/client/lib/api";
import { t } from "~/client/i18n";
import type { SplitMode } from "~/shared/money";

const selectClass = `min-h-11 w-full rounded-[6px] border px-3 text-[14px] ${focusRing}`;
const selectStyle = { background: "var(--paper-sunk)", borderColor: "var(--line)", color: "var(--ink)" };

type IntervalUnit = "day" | "week" | "month";
const units: IntervalUnit[] = ["day", "week", "month"];
const unitLabel = (unit: IntervalUnit, count: number) =>
  t(`recurring.unit${unit[0]!.toUpperCase()}${unit.slice(1)}${count === 1 ? "" : "Plural"}`);

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Epoch ms <-> "YYYY-MM-DD" in UTC, so a series doesn't shift a day for a
// viewer in a different timezone (SPEC: dates are calendar days, not instants).
const epochToDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dateInputToEpoch = (s: string) => Date.parse(`${s}T00:00:00Z`);

function CadenceRow({ series }: { series: Series }) {
  const isPaused = series.pausedAt !== null;
  return (
    <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
      {t("recurring.every")} {series.intervalCount} {unitLabel(series.intervalUnit, series.intervalCount)}
      {" · "}
      {isPaused ? t("recurring.paused") : t("recurring.nextOn", { date: dateFmt.format(series.nextOccurrenceAt) })}
    </div>
  );
}

function SeriesRow({
  series,
  payerName,
  onEdit,
  onToggle,
  onDelete,
  busy,
}: {
  series: Series;
  payerName: string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const isPaused = series.pausedAt !== null;
  return (
    <div
      className="mb-2 rounded-[7px] border px-3.5 py-3"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)", opacity: isPaused ? 0.7 : 1 }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={payerName} />
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-medium">
              {series.description}
              {isPaused && (
                <span
                  className="ml-2 rounded-[5px] border px-1.5 py-0.5 align-middle text-[10.5px] tracking-[0.13em] uppercase"
                  style={{ borderColor: "var(--line-2)", background: "var(--paper-sunk)", color: "var(--ink-3)" }}
                >
                  {t("recurring.paused")}
                </span>
              )}
            </div>
            <CadenceRow series={series} />
          </div>
        </div>
        <Amount paise={series.total} label={t("expense.total")} tone="neutral" />
      </div>
      <div className="mt-2.5 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
          {t("action.edit")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
          {t(isPaused ? "recurring.resume" : "recurring.pause")}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onDelete}>
          {t("recurring.delete")}
        </Button>
      </div>
    </div>
  );
}

function SeriesForm({ ledgerId, editing, onDone }: { ledgerId: string; editing: Series | null; onDone: () => void }) {
  const members = useMembers(ledgerId);
  const categories = useCategories();
  const save = useSaveSeries(ledgerId);

  const roster = useMemo(() => (members.data ?? []).filter((m) => m.leftAt === null), [members.data]);
  const byId = new Map(roster.map((m) => [m.id, m]));

  const [description, setDescription] = useState(editing?.description ?? "");
  const [amountRaw, setAmountRaw] = useState(editing ? paiseToRupeeString(editing.total) : "");
  const [payerId, setPayerId] = useState(editing?.payerMemberId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [mode, setMode] = useState<SplitMode>(editing?.mode ?? "equal");
  const [participantIds, setParticipantIds] = useState<string[]>(editing?.participants.map((p) => p.memberId) ?? roster.map((m) => m.id));
  const [raw, setRaw] = useState<Record<string, string>>(() => {
    if (!editing) return {};
    const out: Record<string, string> = {};
    for (const p of editing.participants) {
      if (p.value === undefined) continue;
      out[p.memberId] = editing.mode === "exact" ? paiseToRupeeString(p.value) : String(p.value);
    }
    return out;
  });
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(editing?.intervalUnit ?? "month");
  const [intervalCount, setIntervalCount] = useState(String(editing?.intervalCount ?? 1));
  const [startAt, setStartAt] = useState(epochToDateInput(editing?.startAt ?? Date.now()));
  const [hasEnd, setHasEnd] = useState(editing?.endAt !== null && editing?.endAt !== undefined);
  const [endAt, setEndAt] = useState(editing?.endAt ? epochToDateInput(editing.endAt) : "");
  const [failure, setFailure] = useState("");

  // New series only: default to the full active roster once members load.
  useEffect(() => {
    if (editing) return;
    setParticipantIds(roster.map((m) => m.id));
    setPayerId((id) => id || roster[0]?.id || "");
  }, [editing, roster.map((m) => m.id).join(",")]);

  const participants: SplitParticipant[] = participantIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ memberId: id, name: m.nickname }] : [];
  });
  const absent = roster.filter((m) => !participantIds.includes(m.id));

  const total = rupeesToPaise(amountRaw);
  const payerIndex = participants.findIndex((p) => p.memberId === payerId);
  const count = Number(intervalCount);
  const result = preview({ total: total ?? 0, mode, payerIndex, participants, raw });
  const blocked =
    !description.trim() ||
    total === null ||
    total === 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    !startAt ||
    (hasEnd && !endAt) ||
    "error" in result ||
    save.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || total === null) return;
    setFailure("");
    const values = splitValues(mode, participants, raw);
    try {
      await save.mutateAsync({
        id: editing?.id,
        description: description.trim(),
        total,
        categoryId,
        notes: notes.trim() || null,
        payerMemberId: payerId,
        mode,
        participants: participants.map((p, i) => ({ memberId: p.memberId, value: values?.[i] })),
        intervalUnit,
        intervalCount: count,
        startAt: dateInputToEpoch(startAt),
        endAt: hasEnd && endAt ? dateInputToEpoch(endAt) : null,
      });
      onDone();
    } catch (err) {
      setFailure(err instanceof ApiError && err.code === "offline" ? t("offline.body") : t("recurring.saveFailed"));
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {editing && (
        <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-2)" }}>
          {t("recurring.editFutureOnly")}
        </p>
      )}

      <Field label={t("expense.description")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
      </Field>

      <Field label={t("expense.amount")} error={amountRaw.trim() && total === null ? t("expense.error.amount") : undefined}>
        <Input inputMode="decimal" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="0.00" />
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
        <select className={selectClass} style={selectStyle} value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)}>
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

      <div className="mb-3 flex items-end gap-2.5">
        <span className="flex-1">
          <Field label={t("recurring.every")}>
            <Input inputMode="numeric" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
          </Field>
        </span>
        <span className="flex-[2] pb-[1px]">
          <select
            aria-label={t("recurring.every")}
            className={selectClass}
            style={selectStyle}
            value={intervalUnit}
            onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u, 2)}
              </option>
            ))}
          </select>
        </span>
      </div>

      <Field label={t("recurring.starts")}>
        <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </Field>

      <label className="mb-3 flex min-h-11 items-center gap-2 text-[13px]">
        <input type="checkbox" checked={!hasEnd} onChange={(e) => setHasEnd(!e.target.checked)} className="h-4 w-4" />
        {t("recurring.endsNever")}
      </label>

      {hasEnd && (
        <Field label={t("recurring.ends")}>
          <Input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
      )}

      <p role="alert" aria-live="assertive" className="mb-2 text-[12px]" style={{ color: "var(--clay)" }}>
        {failure}
      </p>

      <Button type="submit" disabled={blocked} className="w-full">
        {t("action.save")}
      </Button>
    </form>
  );
}

export default function RecurringTab() {
  const { ledgerId = "" } = useParams();
  const series = useSeries(ledgerId);
  const members = useMembers(ledgerId);
  const action = useSeriesAction(ledgerId);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Series | null>(null);

  if (series.isPending || members.isPending) return null;
  if (series.error || members.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const byId = new Map(members.data.map((m) => [m.id, m]));
  const payerName = (s: Series) => byId.get(s.payerMemberId)?.nickname ?? t("member.unknown");

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }
  function openEdit(s: Series) {
    setEditing(s);
    setSheetOpen(true);
  }
  async function handleDelete(id: string) {
    if (!window.confirm(t("recurring.deleteConfirm"))) return;
    await action.mutateAsync({ id, action: "delete" });
  }

  return (
    <>
      <header className="mb-3 flex items-end justify-between gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("recurring.title")}</h1>
        <Button size="sm" onClick={openCreate}>
          {t("recurring.add")}
        </Button>
      </header>

      {series.data.length === 0 ? (
        <EmptyState title={t("recurring.none")} body={t("recurring.noneBody")} />
      ) : (
        series.data.map((s) => (
          <SeriesRow
            key={s.id}
            series={s}
            payerName={payerName(s)}
            busy={action.isPending}
            onEdit={() => openEdit(s)}
            onToggle={() => action.mutate({ id: s.id, action: "pause" })}
            onDelete={() => handleDelete(s.id)}
          />
        ))
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={editing ? t("action.edit") : t("recurring.add")}>
        <SeriesForm ledgerId={ledgerId} editing={editing} onDone={() => setSheetOpen(false)} />
      </Sheet>
    </>
  );
}

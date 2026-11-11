// Recurring series: an expense template plus a cadence. List + create/edit sheet.
// The split UI is SplitEditor's job - this file only collects cadence + dates.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  Amount,
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Rupees,
  ScreenSkeleton,
  Select,
  Sheet,
} from "~/client/components/ui";
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
  useMembers,
  useSaveSeries,
  useSeries,
  useSeriesAction,
  type Series,
} from "~/client/lib/queries";
import { ApiError } from "~/client/lib/api";
import { t } from "~/client/i18n";
import type { SplitMode } from "~/shared/money";

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
    <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
      {t("recurring.every")} {series.intervalCount} {unitLabel(series.intervalUnit, series.intervalCount)}
      {/* A paused series already carries the Paused badge on its row. */}
      {!isPaused && (
        <>
          {" · "}
          {t("recurring.nextOn", { date: dateFmt.format(series.nextOccurrenceAt) })}
        </>
      )}
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
      className="row-in mb-2 rounded-[7px] border px-3.5 py-3"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)", opacity: isPaused ? 0.7 : 1 }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={payerName} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">
              {series.description}
              {isPaused && (
                <span
                  className="ml-2 rounded-[5px] border px-1.5 py-0.5 align-middle text-[13px] tracking-[0.13em] uppercase"
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
  const [participantIds, setParticipantIds] = useState<string[]>(
    editing?.participants.map((p) => p.memberId) ?? roster.map((m) => m.id),
  );
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
  const [startAt, setStartAt] = useState(() => epochToDateInput(editing?.startAt ?? Date.now()));
  const [hasEnd, setHasEnd] = useState(editing?.endAt !== null && editing?.endAt !== undefined);
  const [endAt, setEndAt] = useState(editing?.endAt ? epochToDateInput(editing.endAt) : "");
  const [failure, setFailure] = useState("");

  // New series only: default to the full active roster once members load, once.
  // A later roster change only drops people who left; it must not re-add deselected
  // people or wipe what was typed.
  const seeded = useRef(false);
  useEffect(() => {
    if (editing || roster.length === 0) return;
    const ids = new Set(roster.map((m) => m.id));
    const firstPayer = roster[0]?.id ?? "";
    if (!seeded.current) {
      seeded.current = true;
      setParticipantIds(roster.map((m) => m.id));
      setPayerId(firstPayer);
      return;
    }
    setParticipantIds((prev) => prev.filter((id) => ids.has(id)));
    setRaw((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
    setPayerId((prev) => (ids.has(prev) ? prev : firstPayer));
  }, [editing, roster.map((m) => m.id).join(",")]);

  const participants: SplitParticipant[] = participantIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ memberId: id, name: m.nickname }] : [];
  });

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
    // Any field edit makes the last save error stale. A form-level onChange catches
    // every input and select; the picker and split controls are wired below.
    <form onSubmit={submit} onChange={() => setFailure("")} noValidate>
      {editing && (
        <p className="mb-3 text-[13px]" style={{ color: "var(--ink-2)" }}>
          {t("recurring.editFutureOnly")}
        </p>
      )}

      <Field label={t("expense.description")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
      </Field>

      <Field
        label={t("expense.amount")}
        error={amountRaw.trim() && total === null ? t("expense.error.amount") : undefined}
      >
        <Rupees value={amountRaw} onChange={setAmountRaw} />
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

      {/* Same picker as the expense form. A series splits between people exactly
          the way a one-off does, so it must not have a second way of saying so. */}
      <div className="mb-3">
        <ParticipantPicker
          members={roster.map((m) => ({ id: m.id, name: m.nickname }))}
          selectedIds={participantIds}
          onChange={(ids) => {
            setFailure("");
            setParticipantIds(ids);
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
          setFailure("");
          setMode(m);
        }}
        onRawChange={(r) => {
          setFailure("");
          setRaw(r);
        }}
      />

      <div className="mb-3 flex items-end gap-2.5">
        <span className="flex-1">
          <Field label={t("recurring.every")}>
            <Input inputMode="numeric" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
          </Field>
        </span>
        <span className="flex-[2] pb-[1px]">
          <Select
            aria-label={t("recurring.every")}
            value={intervalUnit}
            onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u, 2)}
              </option>
            ))}
          </Select>
        </span>
      </div>

      <Field label={t("recurring.starts")}>
        <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </Field>

      <label className="mb-3 flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" checked={!hasEnd} onChange={(e) => setHasEnd(!e.target.checked)} className="h-4 w-4" />
        {t("recurring.endsNever")}
      </label>

      {hasEnd && (
        <Field label={t("recurring.ends")}>
          <Input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
      )}

      <p role="alert" aria-live="assertive" className="mb-2 text-[13px]" style={{ color: "var(--clay)" }}>
        {failure}
      </p>

      <Button type="submit" disabled={blocked} block>
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (series.isPending || members.isPending) return <ScreenSkeleton />;
  if (series.error || members.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  // Looked up from the live list: a series deleted elsewhere closes the dialog.
  const deleting = series.data.find((s) => s.id === deletingId) ?? null;

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
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 className="serif text-[19px]">{t("recurring.title")}</h2>
        <Button size="sm" onClick={openCreate}>
          {t("recurring.add")}
        </Button>
      </div>

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
            onDelete={() => setDeletingId(s.id)}
          />
        ))
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={editing ? t("action.edit") : t("recurring.add")}>
        <SeriesForm ledgerId={ledgerId} editing={editing} onDone={() => setSheetOpen(false)} />
      </Sheet>

      {deleting && (
        <ConfirmDialog
          title={t("recurring.deleteConfirm")}
          confirmLabel={t("recurring.delete")}
          busy={action.isPending}
          onCancel={() => setDeletingId(null)}
          onConfirm={() =>
            action.mutate({ id: deleting.id, action: "delete" }, { onSuccess: () => setDeletingId(null) })
          }
        />
      )}
    </>
  );
}

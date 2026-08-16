// Everything you can do TO a ledger, as opposed to inside it: its details, its
// roster, its invite link, and ending it. These used to sit inline on the ledger
// screen, where four permanent controls competed with the expenses they were
// supposed to be secondary to.
//
// Native button plus an absolutely-positioned panel - no menu library, and no
// new dependency for what a few lines of state cover.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Field, Input, Rupees, Select } from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { rupeesToPaise, paiseToRupeeString } from "~/client/components/SplitEditor";
import { api, ApiError } from "~/client/lib/api";
import {
  qk,
  useAddGuest,
  useCreateInvite,
  useDeleteLedger,
  useLeaveLedger,
  useLedgerLifecycle,
  useMe,
  useMembers,
  useUpdateLedger,
  type LedgerSummary,
  type Member,
} from "~/client/lib/queries";
import type { UpdateLedger } from "~/shared/schemas";
import { t } from "~/client/i18n";

/** End of the chosen day in LOCAL time, and its inverse for the date input.
 *  Same rule as LedgerForm uses at creation - a ledger ending "on the 5th"
 *  includes the 5th, and a UTC round-trip would move that day for half the
 *  world. */
const endOfLocalDay = (yyyymmdd: string) => new Date(`${yyyymmdd}T23:59:59`).getTime();
const localDateValue = (ms: number | null) => {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export type LedgerEdit = { name: string; endDate: string; budget: string };

/** The edit form's fields -> a PATCH body holding ONLY what actually changed.
 *  Both nullable fields have an empty string meaning "clear it", which is not
 *  the same as "leave it alone", so a diff is the only way to tell a cleared
 *  budget from an untouched one. Paise are integers here or the patch is
 *  refused - a half-parsed amount must never reach the wire. */
export function ledgerPatch(
  ledger: Pick<LedgerSummary, "name" | "endDate" | "budget">,
  edit: LedgerEdit,
): { ok: true; patch: UpdateLedger } | { ok: false; error: string } {
  const name = edit.name.trim();
  if (!name) return { ok: false, error: "ledger.nameRequired" };

  const endDate = edit.endDate === "" ? null : endOfLocalDay(edit.endDate);
  if (endDate !== null && Number.isNaN(endDate)) return { ok: false, error: "ledger.endDateInvalid" };

  let budget: number | null = null;
  if (edit.budget.trim() !== "") {
    budget = rupeesToPaise(edit.budget);
    if (budget === null || budget <= 0) return { ok: false, error: "ledger.budgetInvalid" };
  }

  const patch: UpdateLedger = {};
  if (name !== ledger.name) patch.name = name;
  if (endDate !== ledger.endDate) patch.endDate = endDate;
  if (budget !== ledger.budget) patch.budget = budget;
  return { ok: true, patch };
}

const hint = { color: "var(--ink-3)" } as const;
const rule = { borderColor: "var(--line)" } as const;

/** Rename, re-date, re-budget. Nothing here is destructive, so it saves on
 *  submit and says so rather than confirming first. */
function EditPanel({ ledger }: { ledger: LedgerSummary }) {
  const update = useUpdateLedger(ledger.id);
  const [name, setName] = useState(ledger.name);
  const [endDate, setEndDate] = useState(localDateValue(ledger.endDate));
  const [budget, setBudget] = useState(ledger.budget === null ? "" : paiseToRupeeString(ledger.budget));
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFailure("");
    setSaved(false);
    const result = ledgerPatch(ledger, { name, endDate, budget });
    if (!result.ok) return setFailure(t(result.error));
    update.mutate(result.patch, {
      onSuccess: () => setSaved(true),
      onError: () => setFailure(t("ledger.saveFailed")),
    });
  };

  return (
    // noValidate for the same reason LedgerForm has it: the in-page messages are
    // the single mechanism, native bubbles are not always shown.
    <form onSubmit={onSubmit} noValidate>
      <Field label={t("ledger.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <Field label={t("ledger.endDateOptional")}>
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </Field>
      <p className="mb-3 text-[11.5px]" style={hint}>
        {t("ledger.endDateHint")}
      </p>
      <Field label={t("ledger.budgetOptional")}>
        <Rupees value={budget} onChange={setBudget} />
      </Field>
      <p className="mb-3 text-[11.5px]" style={hint}>
        {t("ledger.budgetHint")}
      </p>

      {failure && (
        <p role="alert" className="mb-3 text-[12.5px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}
      {saved && (
        <p role="status" aria-live="polite" className="mb-3 text-[12.5px]" style={{ color: "var(--moss-2)" }}>
          {t("ledger.saved")}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={update.isPending}>
        {t("action.save")}
      </Button>
    </form>
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
    <div className="mt-1 border-t pt-2.5" style={rule}>
      <div className="mb-1.5 text-[10.5px] tracking-[0.13em] uppercase" style={hint}>
        {t("member.addExisting")}
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11.5px]" style={hint}>
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
      <p className="text-[11.5px]" style={hint}>
        {t("member.addExistingHint")}
      </p>
      <p role="status" aria-live="polite" className="mt-1.5 text-[11.5px]" style={{ color: add.isError ? "var(--clay)" : "var(--moss-2)" }}>
        {add.isError ? t("member.addExistingFailed") : added}
      </p>
    </div>
  );
}

/** A guest is DATA: a name that splits and can pay, with no account, no sign-in
 *  and no session. The server only lets the Owner create one, so the form is
 *  shown to nobody else rather than offered and then refused. */
function AddGuest({ ledgerId }: { ledgerId: string }) {
  const addGuest = useAddGuest(ledgerId);
  const [guestName, setGuestName] = useState("");
  const [added, setAdded] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = guestName.trim();
    if (!trimmed) return;
    setAdded("");
    addGuest.mutate(trimmed, {
      onSuccess: (member) => {
        setAdded(t("member.addGuestDone", { name: member.nickname }));
        setGuestName("");
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-1 border-t pt-2.5" style={rule}>
      <div className="mb-1.5 text-[10.5px] tracking-[0.13em] uppercase" style={hint}>
        {t("member.addGuest")}
      </div>
      <div className="flex items-end gap-2">
        <span className="min-w-0 flex-1">
          <Field label={t("member.addGuestName")}>
            <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={80} />
          </Field>
        </span>
        <Button type="submit" size="sm" className="mb-3" disabled={!guestName.trim() || addGuest.isPending}>
          {t("member.addGuestAction")}
        </Button>
      </div>
      <p className="text-[11.5px]" style={hint}>
        {t("member.addGuestHint")}
      </p>
      <p role="status" aria-live="polite" className="mt-1.5 text-[11.5px]" style={{ color: addGuest.isError ? "var(--clay)" : "var(--moss-2)" }}>
        {addGuest.isError ? t("member.addGuestFailed") : added}
      </p>
    </form>
  );
}

/** Leaving is blocked while your net position is non-zero (SPEC §4), and the
 *  server is the one that knows - so the refusal code, not a client guess, picks
 *  the message. */
function LeaveLedger({ ledgerId }: { ledgerId: string }) {
  const navigate = useNavigate();
  const leave = useLeaveLedger(ledgerId);
  const [confirming, setConfirming] = useState(false);

  const failure =
    leave.error instanceof ApiError && leave.error.code === "non_zero_position"
      ? t("member.leaveBlocked")
      : t("member.leaveFailed");

  return (
    <div className="mt-1 border-t pt-2.5" style={rule}>
      <Button variant="danger" size="sm" disabled={leave.isPending} onClick={() => setConfirming(true)}>
        {t("member.leave")}
      </Button>
      <p className="mt-1.5 text-[11.5px]" style={hint}>
        {t("member.leaveHint")}
      </p>
      {leave.isError && (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          message={t("member.leaveConfirm")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            leave.mutate(undefined, { onSuccess: () => navigate("/") });
          }}
        />
      )}
    </div>
  );
}

function MembersPanel({ ledgerId }: { ledgerId: string }) {
  const members = useMembers(ledgerId);
  const me = useMe();

  return (
    <>
      {(members.data ?? []).map((m) => (
        <div key={m.id} className="flex items-center gap-2.5 py-1.5">
          <Avatar name={m.nickname} />
          <span className="flex-1 truncate text-[14px]">{m.nickname}</span>
          {m.guestName !== null && (
            <span className="text-[11.5px]" style={hint}>
              {t("member.guest")}
            </span>
          )}
        </div>
      ))}
      <AddExistingMember ledgerId={ledgerId} />
      {me.data?.isOwner && <AddGuest ledgerId={ledgerId} />}
      <LeaveLedger ledgerId={ledgerId} />
    </>
  );
}

/** The invite link, and the switch that decides whether this ledger has one at
 *  all (ADR 0007).
 *
 *  With the switch off there is no mint control: the server would refuse with
 *  409 invites_disabled, and offering a button that cannot work is worse than
 *  explaining the switch. The token itself is held in component state only -
 *  navigating away loses it and a new invite must be minted, which is correct:
 *  an invite is a bearer credential, so it is never re-fetchable. */
function InvitePanel({ ledger }: { ledger: LedgerSummary }) {
  const update = useUpdateLedger(ledger.id);
  const create = useCreateInvite(ledger.id);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = () =>
    create.mutate(undefined, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}/welcome?invite=${encodeURIComponent(token)}`);
        setCopied(false);
      },
    });

  const toggle = (enabled: boolean) => {
    // A link minted before the switch went off stops working, so the one on
    // screen is stale the moment it is disabled - drop it rather than let it be
    // copied.
    setLink(null);
    update.mutate({ invitesEnabled: enabled });
  };

  return (
    <>
      <label className="flex items-center gap-2.5 text-[14px]">
        <input
          type="checkbox"
          checked={ledger.invitesEnabled}
          disabled={update.isPending}
          onChange={(e) => toggle(e.target.checked)}
          className={`h-4 w-4 ${focusRing}`}
          style={{ accentColor: "var(--moss)" }}
        />
        {t("ledger.invitesEnabled")}
      </label>
      <p className="mt-1.5 text-[11.5px]" style={hint}>
        {t(ledger.invitesEnabled ? "ledger.invitesOnHint" : "ledger.invitesOffHint")}
      </p>
      <p className="mt-1.5 text-[11.5px]" style={hint}>
        {t("ledger.invitesRevival")}
      </p>
      {update.isError && (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--clay)" }}>
          {t("ledger.invitesToggleFailed")}
        </p>
      )}

      {ledger.invitesEnabled && (
        <div className="mt-2.5 border-t pt-2.5" style={rule}>
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
              <p className="mt-1.5 text-[11.5px]" style={hint}>
                {t("ledger.inviteHint")}
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Same shape as the confirm dialogs in AdminPanel: alertdialog, modal, cancel
 *  first so the destructive button is never the one under a stray tap. */
function ConfirmDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgb(0 0 0 / 38%)" }}>
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-[10px] border p-4" style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
        <p className="mb-3 text-[14px]">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t("action.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

type Panel = "edit" | "members" | "invite";

export function LedgerMenu({ ledger }: { ledger: LedgerSummary }) {
  const navigate = useNavigate();
  const lifecycle = useLedgerLifecycle(ledger.id);
  const remove = useDeleteLedger(ledger.id);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Escape closes the menu wherever focus is, and focus goes back to the button
  // that opened it - a menu that dumps focus on <body> is a keyboard dead end.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus moves back to the trigger BEFORE the sheet mounts, because <Sheet>
  // remembers whatever was focused at mount and returns focus there on close.
  const pick = (next: Panel) => {
    trigger.current?.focus();
    setOpen(false);
    setPanel(next);
  };

  const archived = ledger.archivedAt !== null;

  const lifecycleFailure =
    lifecycle.error instanceof ApiError && lifecycle.error.code === "not_settled"
      ? t("ledger.archiveBlocked")
      : t("ledger.archiveFailed");
  const deleteFailure =
    remove.error instanceof ApiError && remove.error.code === "not_creator"
      ? t("ledger.deleteBlocked")
      : t("ledger.deleteFailed");

  const item = `block w-full px-3.5 py-2.5 text-left text-[14px] ${focusRing}`;

  return (
    <>
      <span className="relative flex-none">
        <button
          ref={trigger}
          type="button"
          aria-label={t("ledger.menu.open")}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          className={`grid min-h-11 min-w-11 place-items-center rounded-[6px] text-[17px] ${focusRing}`}
          style={{ color: "var(--ink-3)" }}
        >
          ⋯
        </button>
        {open && (
          <>
            {/* Catches the tap that means "not this after all". */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="menu"
              aria-label={t("ledger.menu.open")}
              className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-[8px] border py-1"
              style={{ background: "var(--paper)", borderColor: "var(--line)" }}
            >
              <button type="button" role="menuitem" className={item} onClick={() => pick("edit")}>
                {t("ledger.menu.edit")}
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => pick("members")}>
                {t("ledger.menu.members")}
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => pick("invite")}>
                {t("ledger.menu.invite")}
              </button>
              <div className="my-1 border-t" style={rule} />
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  trigger.current?.focus();
                  setOpen(false);
                  // Reopening is not destructive and needs no confirmation.
                  if (archived) lifecycle.mutate("reopen");
                  else setConfirming("archive");
                }}
              >
                {t(archived ? "ledger.menu.reopen" : "ledger.menu.archive")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                style={{ color: "var(--clay)" }}
                onClick={() => {
                  trigger.current?.focus();
                  setOpen(false);
                  setConfirming("delete");
                }}
              >
                {t("ledger.menu.delete")}
              </button>
            </div>
          </>
        )}
      </span>

      <Sheet open={panel === "edit"} onOpenChange={() => setPanel(null)} title={t("ledger.menu.edit")}>
        <EditPanel ledger={ledger} />
      </Sheet>
      <Sheet open={panel === "members"} onOpenChange={() => setPanel(null)} title={t("ledger.menu.members")}>
        <MembersPanel ledgerId={ledger.id} />
      </Sheet>
      <Sheet open={panel === "invite"} onOpenChange={() => setPanel(null)} title={t("ledger.menu.invite")}>
        <InvitePanel ledger={ledger} />
      </Sheet>

      {(lifecycle.isError || remove.isError) && (
        <p role="alert" className="mx-0.5 mb-2 text-[11.5px]" style={{ color: "var(--clay)" }}>
          {lifecycle.isError ? lifecycleFailure : deleteFailure}
        </p>
      )}

      {confirming === "archive" && (
        <ConfirmDialog
          message={t("ledger.archiveConfirm")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            lifecycle.mutate("archive");
          }}
        />
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          message={t("ledger.deleteConfirm", { name: ledger.name })}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            remove.mutate(undefined, { onSuccess: () => navigate("/") });
          }}
        />
      )}
    </>
  );
}

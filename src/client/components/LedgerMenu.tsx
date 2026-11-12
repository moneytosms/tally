// Everything you can do TO a ledger, as opposed to inside it: its details, its
// roster, its invite link, and ending it. These used to sit inline on the ledger
// screen, where four permanent controls competed with the expenses they were
// supposed to be secondary to.
//
// Native button plus an absolutely-positioned panel - no menu library, and no
// new dependency for what a few lines of state cover.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Amount,
  Avatar,
  Button,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  Rupees,
  Select,
  Skeleton,
} from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { LedgerAppearanceFields } from "~/client/components/LedgerForm";
import { ExportSheet } from "~/client/components/ExportSheet";
import { guessMapping } from "~/client/lib/guessMapping";
import { rupeesToPaise, paiseToRupeeString } from "~/client/components/SplitEditor";
import { api, ApiError } from "~/client/lib/api";
import { useCopied } from "~/client/lib/useCopied";
import {
  qk,
  useAddGuest,
  useBalances,
  useCreateInvite,
  useCreateLedger,
  useDeleteLedger,
  useLeaveLedger,
  useImportCommit,
  useImportPreview,
  useLedgerLifecycle,
  useMe,
  useMembers,
  useMergeGuest,
  useRemoveMember,
  useUpdateLedger,
  type ImportParseResult,
  type LedgerColor,
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

export type LedgerEdit = { name: string; endDate: string; budget: string; color: LedgerColor | null; emoji: string };

/** The edit form's fields -> a PATCH body holding ONLY what actually changed.
 *  Both nullable fields have an empty string meaning "clear it", which is not
 *  the same as "leave it alone", so a diff is the only way to tell a cleared
 *  budget from an untouched one. Paise are integers here or the patch is
 *  refused - a half-parsed amount must never reach the wire. */
export function ledgerPatch(
  ledger: Pick<LedgerSummary, "name" | "endDate" | "budget" | "color" | "emoji">,
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
  if (edit.color !== ledger.color) patch.color = edit.color;
  const emoji = edit.emoji.trim() || null;
  if (emoji !== ledger.emoji) patch.emoji = emoji;
  return { ok: true, patch };
}

const hint = { color: "var(--ink-3)" } as const;
const sectionLabel = { color: "var(--ink-2)" } as const;
const rule = { borderColor: "var(--line)" } as const;

/** Rename, re-date, re-budget. Nothing here is destructive, so it saves on
 *  submit and says so rather than confirming first. */
function EditPanel({ ledger }: { ledger: LedgerSummary }) {
  const update = useUpdateLedger(ledger.id);
  // What the form was opened with. The diff is against this, not the live ledger:
  // if someone else renames it while this is open, an untouched field must not
  // send the old name back.
  const [baseline, setBaseline] =
    useState<Pick<LedgerSummary, "name" | "endDate" | "budget" | "color" | "emoji">>(ledger);
  const [name, setName] = useState(baseline.name);
  const [endDate, setEndDate] = useState(localDateValue(baseline.endDate));
  const [budget, setBudget] = useState(baseline.budget === null ? "" : paiseToRupeeString(baseline.budget));
  const [color, setColor] = useState<LedgerColor | null>(baseline.color);
  const [emoji, setEmoji] = useState(baseline.emoji ?? "");
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);

  const edited = () => {
    setSaved(false);
    setFailure("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFailure("");
    setSaved(false);
    const result = ledgerPatch(baseline, { name, endDate, budget, color, emoji });
    if (!result.ok) return setFailure(t(result.error));
    const { patch } = result;
    update.mutate(patch, {
      onSuccess: () => {
        // Saved values become the baseline, or a later edit back to the old value
        // would diff as "unchanged" and never reach the server.
        setBaseline((b) => ({
          name: patch.name ?? b.name,
          endDate: patch.endDate === undefined ? b.endDate : patch.endDate,
          budget: patch.budget === undefined ? b.budget : patch.budget,
          color: patch.color === undefined ? b.color : patch.color,
          emoji: patch.emoji === undefined ? b.emoji : patch.emoji,
        }));
        setSaved(true);
      },
      onError: () => setFailure(t("ledger.saveFailed")),
    });
  };

  return (
    // noValidate for the same reason LedgerForm has it: the in-page messages are
    // the single mechanism, native bubbles are not always shown.
    <form onSubmit={onSubmit} noValidate>
      <Field label={t("ledger.name")}>
        <Input
          value={name}
          onChange={(e) => {
            edited();
            setName(e.target.value);
          }}
          required
          maxLength={80}
        />
      </Field>
      <LedgerAppearanceFields
        name={name}
        color={color}
        emoji={emoji}
        onColor={(c) => {
          edited();
          setColor(c);
        }}
        onEmoji={(e) => {
          edited();
          setEmoji(e);
        }}
      />
      <Field label={t("ledger.endDateOptional")}>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => {
            edited();
            setEndDate(e.target.value);
          }}
        />
      </Field>
      <p className="mb-3 text-[13px]" style={hint}>
        {t("ledger.endDateHint")}
      </p>
      <Field label={t("ledger.budgetOptional")}>
        <Rupees
          value={budget}
          onChange={(v) => {
            edited();
            setBudget(v);
          }}
        />
      </Field>
      <p className="mb-3 text-[13px]" style={hint}>
        {t("ledger.budgetHint")}
      </p>

      {failure && (
        <p role="alert" className="mb-3 text-[13px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}
      {saved && (
        <p role="status" aria-live="polite" className="mb-3 text-[13px]" style={{ color: "var(--moss-2)" }}>
          {t("ledger.saved")}
        </p>
      )}

      <Button type="submit" className="w-full" isLoading={update.isPending}>
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
  // Derived: if the picked person was added from elsewhere and left the list,
  // nothing is picked any more and Add stays disabled.
  const pickedUser = candidates.find((u) => u.id === picked);

  return (
    <div className="mt-1 border-t pt-2.5" style={rule}>
      <div className="mb-1.5 text-[13px] font-semibold" style={sectionLabel}>
        {t("member.addExisting")}
      </div>
      {addable.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : candidates.length === 0 ? (
        <p className="text-[13px]" style={hint}>
          {t("member.addExistingNone")}
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <span className="min-w-0 flex-1">
            <Field label={t("member.pick")}>
              <Select value={pickedUser?.id ?? ""} onChange={(e) => setPicked(e.target.value)}>
                <option value="">{t("action.select")}</option>
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
            variant={pickedUser ? "primary" : "ghost"}
            disabled={!pickedUser}
            isLoading={add.isPending}
            onClick={() => {
              if (!pickedUser) return;
              setAdded("");
              add.mutate(pickedUser.id);
            }}
          >
            {t("member.addExistingAction")}
          </Button>
        </div>
      )}
      <p className="text-[13px]" style={hint}>
        {t("member.addExistingHint")}
      </p>
      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 text-[13px]"
        style={{ color: add.isError ? "var(--clay)" : "var(--moss-2)" }}
      >
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
      <div className="mb-1.5 text-[13px] font-semibold" style={sectionLabel}>
        {t("member.addGuest")}
      </div>
      <div className="flex items-end gap-2">
        <span className="min-w-0 flex-1">
          <Field label={t("member.addGuestName")}>
            <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={80} />
          </Field>
        </span>
        <Button
          type="submit"
          size="sm"
          className="mb-3"
          variant={guestName.trim() ? "primary" : "ghost"}
          isLoading={addGuest.isPending}
          disabled={!guestName.trim()}
        >
          {t("member.addGuestAction")}
        </Button>
      </div>
      <p className="text-[13px]" style={hint}>
        {t("member.addGuestHint")}
      </p>
      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 text-[13px]"
        style={{ color: addGuest.isError ? "var(--clay)" : "var(--moss-2)" }}
      >
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
      <p className="mt-1.5 text-[13px]" style={hint}>
        {t("member.leaveHint")}
      </p>
      {leave.isError && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t("confirm.leaveLedger.title")}
          body={t("member.leaveConfirm")}
          confirmLabel={t("confirm.leaveLedger.action")}
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

/** Owner-only removal of someone else - for a member who has gone inactive or
 *  left the group outside the app. Same zero-balance guard as self-leave, just
 *  aimed by the owner (SPEC §4): the server, not a client guess, has the last
 *  word on whether the position is actually zero. */
function MembersPanel({ ledgerId }: { ledgerId: string }) {
  const members = useMembers(ledgerId);
  const balances = useBalances(ledgerId);
  const me = useMe();
  const removeMember = useRemoveMember(ledgerId);
  const mergeGuest = useMergeGuest(ledgerId);
  const [confirmingRemove, setConfirmingRemove] = useState<Member | null>(null);
  const [removeFailure, setRemoveFailure] = useState("");
  // One value for the whole merge flow. The guest and target are looked up from
  // the live roster each render, so a member removed mid-flow drops out here
  // instead of leaving a stale select or a dialog for someone who is gone.
  const [merge, setMerge] = useState<{
    guestId: string;
    targetId: string | null;
    confirming: boolean;
    failed: boolean;
  } | null>(null);

  const realMembers = (members.data ?? []).filter((m) => m.guestName === null);
  const guest = merge ? (members.data ?? []).find((m) => m.id === merge.guestId && m.guestName !== null) : undefined;
  const mergeTargetMember = merge?.targetId ? realMembers.find((rm) => rm.id === merge.targetId) : undefined;
  // The viewer's own position is "You owe"; everyone else's needs naming.
  const myMemberId = (members.data ?? []).find((m) => m.userId === me.data?.id)?.id;

  const positionByMemberId = new Map((balances.data?.positions ?? []).map((p) => [p.memberId, p.net]));

  if (members.isPending)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );

  return (
    <>
      {(members.data ?? []).map((m) => {
        const net = positionByMemberId.get(m.id) ?? 0;
        return (
          <div key={m.id} className="flex flex-col py-1.5">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={m.nickname} />
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{m.nickname}</div>
                  {m.guestName !== null && (
                    <span className="text-[13px]" style={hint}>
                      {t("member.guest")}
                    </span>
                  )}
                </div>
              </div>
              <Amount
                paise={net}
                label={t("ledger.netPosition")}
                subject={m.id === myMemberId ? undefined : m.nickname}
              />
            </div>
            <div className="mt-1 flex gap-1.5">
              {m.guestName !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mergeGuest.isPending || realMembers.length === 0}
                  onClick={() => setMerge({ guestId: m.id, targetId: null, confirming: false, failed: false })}
                >
                  {t("member.merge")}
                </Button>
              )}
              {me.data?.isOwner && m.userId !== me.data.id && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={removeMember.isPending}
                  onClick={() => {
                    setRemoveFailure("");
                    setConfirmingRemove(m);
                  }}
                >
                  {t("member.remove")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <AddExistingMember ledgerId={ledgerId} />
      {me.data?.isOwner && <AddGuest ledgerId={ledgerId} />}
      {removeFailure && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {removeFailure}
        </p>
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title={t("confirm.removeMember.title", { name: confirmingRemove.nickname })}
          body={t("member.removeConfirm")}
          confirmLabel={t("confirm.removeMember.action", { name: confirmingRemove.nickname })}
          onCancel={() => setConfirmingRemove(null)}
          onConfirm={() => {
            const target = confirmingRemove;
            setConfirmingRemove(null);
            removeMember.mutate(target.id, {
              onError: (e) => {
                setRemoveFailure(
                  e instanceof ApiError && e.code === "non_zero_position"
                    ? t("member.removeBlocked", { name: target.nickname })
                    : t("member.removeFailed"),
                );
              },
            });
          }}
        />
      )}

      {merge && guest && (
        <div className="mt-1 border-t pt-2.5" style={rule}>
          <div className="mb-1.5 text-[13px] font-semibold" style={sectionLabel}>
            {t("member.mergeTitle", { name: guest.nickname })}
          </div>
          <div className="flex items-end gap-2">
            <span className="min-w-0 flex-1">
              <Field label={t("member.mergeTarget")}>
                <Select
                  value={mergeTargetMember?.id ?? ""}
                  onChange={(e) =>
                    setMerge({ ...merge, targetId: e.target.value || null, confirming: false, failed: false })
                  }
                >
                  <option value="">{t("action.select")}</option>
                  {realMembers.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.nickname}
                    </option>
                  ))}
                </Select>
              </Field>
            </span>
            <Button
              size="sm"
              className="mb-3"
              variant={mergeTargetMember ? "primary" : "ghost"}
              disabled={!mergeTargetMember}
              isLoading={mergeGuest.isPending}
              onClick={() => setMerge({ ...merge, confirming: true })}
            >
              {t("member.mergeAction")}
            </Button>
            <Button variant="ghost" size="sm" className="mb-3" onClick={() => setMerge(null)}>
              {t("member.mergeCancel")}
            </Button>
          </div>
          <p className="text-[13px]" style={hint}>
            {t("member.mergeHint")}
          </p>
          {merge.failed && (
            <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
              {t("member.mergeFailed")}
            </p>
          )}
          {merge.confirming && mergeTargetMember && (
            <ConfirmDialog
              title={t("confirm.mergeGuest.title", { guest: guest.nickname, name: mergeTargetMember.nickname })}
              body={t("member.mergeHint")}
              confirmLabel={t("confirm.mergeGuest.action")}
              onCancel={() => setMerge({ ...merge, confirming: false })}
              onConfirm={() => {
                setMerge({ ...merge, confirming: false });
                mergeGuest.mutate(
                  { guestMemberId: guest.id, targetMemberId: mergeTargetMember.id },
                  {
                    onSuccess: () => setMerge(null),
                    onError: () => setMerge((s) => (s?.guestId === guest.id ? { ...s, failed: true } : s)),
                  },
                );
              }}
            />
          )}
        </div>
      )}
      {/* Leaving is the one destructive action here, so it sits last, apart from the rest. */}
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
  const copy = useCopied();

  // A link minted before the switch went off stops working, so the one on screen
  // is stale the moment invites are disabled - here or on another device. Dropped
  // rather than left to reappear when the switch goes back on.
  const [wasEnabled, setWasEnabled] = useState(ledger.invitesEnabled);
  if (wasEnabled !== ledger.invitesEnabled) {
    setWasEnabled(ledger.invitesEnabled);
    if (!ledger.invitesEnabled) setLink(null);
  }

  const mint = () =>
    create.mutate(undefined, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}/welcome?invite=${encodeURIComponent(token)}`);
      },
    });

  const toggle = (enabled: boolean) => {
    if (!enabled) setLink(null);
    update.mutate({ invitesEnabled: enabled });
  };

  return (
    <>
      <label className="flex items-center gap-2.5 text-[15px]">
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
      <p className="mt-1.5 text-[13px]" style={hint}>
        {t(ledger.invitesEnabled ? "ledger.invitesOnHint" : "ledger.invitesOffHint")}
      </p>
      <p className="mt-1.5 text-[13px]" style={hint}>
        {t("ledger.invitesRevival")}
      </p>
      {update.isError && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("ledger.invitesToggleFailed")}
        </p>
      )}

      {ledger.invitesEnabled && (
        <div className="mt-2.5 border-t pt-2.5" style={rule}>
          {link === null ? (
            <>
              <Button variant="ghost" size="sm" isLoading={create.isPending} onClick={mint}>
                {t("ledger.invite")}
              </Button>
              {create.isError && (
                <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
                  {t("error.generic")}
                </p>
              )}
            </>
          ) : (
            <>
              <p
                className="mb-1.5 rounded-[6px] border px-2.5 py-2 text-[13px] break-all"
                style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
              >
                {link}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => copy.copy(link)}>
                  {t(copy.copied === link ? "ledger.inviteCopied" : "ledger.inviteCopy")}
                </Button>
              </div>
              <p className="mt-1.5 text-[13px]" style={hint}>
                {t("ledger.inviteHint")}
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Repeat trip groups: same people, new dates. Prompts for a name and creates a
 *  new ledger cloning this one's CURRENT members - the same mechanism
 *  LedgerForm's "clone from" uses at creation (SPEC §8), just reached from an
 *  existing ledger instead of a blank form. Categories are shared
 *  instance-wide already (never ledger-scoped), so there is nothing to copy
 *  there - the duplicate sees the same category list automatically. The new
 *  ledger starts with zero expenses, by construction. */
function DuplicatePanel({ ledger, onDone }: { ledger: LedgerSummary; onDone: (ledgerId: string) => void }) {
  const create = useCreateLedger();
  const [name, setName] = useState(`${ledger.name} copy`);
  const [failure, setFailure] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setFailure(t("ledger.nameRequired"));
    setFailure("");
    create.mutate(
      { name: trimmed, cloneFrom: ledger.id, endDate: null, budget: null, color: ledger.color, emoji: ledger.emoji },
      {
        onSuccess: (created) => onDone(created.id),
        onError: () => setFailure(t("ledger.duplicateFailed")),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t("ledger.duplicateName")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      </Field>
      <p className="mb-3 text-[13px]" style={hint}>
        {t("ledger.duplicateHint")}
      </p>
      {failure && (
        <p role="alert" className="mb-3 text-[13px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}
      <Button type="submit" className="w-full" isLoading={create.isPending}>
        {t("ledger.duplicateAction")}
      </Button>
    </form>
  );
}

/** Splid/Splitwise import: parse -> map source names to members (or, Owner
 *  only, new guests) -> commit. The parsed rows are held in state between
 *  preview and commit - no server-side session, no re-upload. */
function ImportPanel({ ledgerId }: { ledgerId: string }) {
  const me = useMe();
  const members = useMembers(ledgerId);
  const preview = useImportPreview(ledgerId);
  const commit = useImportCommit(ledgerId);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [newGuestNames, setNewGuestNames] = useState<Record<string, string>>({});
  const [done, setDone] = useState<number | null>(null);

  const memberList = members.data ?? [];

  const onFile = (file: File) => {
    setParsed(null);
    setMapping({});
    setNewGuestNames({});
    setDone(null);
    preview.mutate(file, {
      onSuccess: (result) => {
        setParsed(result);
        setMapping(guessMapping(result.sourceNames, memberList));
      },
    });
  };

  const setMemberMapping = (sourceName: string, memberId: string) => {
    setMapping((m) => ({ ...m, [sourceName]: memberId }));
    setNewGuestNames((g) => {
      const { [sourceName]: _drop, ...rest } = g;
      return rest;
    });
  };

  const setGuestMapping = (sourceName: string) => {
    setMapping((m) => {
      const { [sourceName]: _drop, ...rest } = m;
      return rest;
    });
    setNewGuestNames((g) => ({ ...g, [sourceName]: sourceName }));
  };

  const unmapped = (parsed?.sourceNames ?? []).filter((n) => !(n in mapping) && !(n in newGuestNames));
  const canConfirm = parsed !== null && unmapped.length === 0 && parsed.rows.length > 0;

  const onConfirm = () => {
    if (!parsed) return;
    commit.mutate(
      { rows: parsed.rows, mapping, newGuests: newGuestNames },
      {
        onSuccess: (r) => {
          setDone(r.created);
          // Clear the parsed rows so the panel returns to its file-picker
          // state - a stale "confirm" otherwise re-posts the same payload
          // and duplicates every expense (and any new guests) on a second tap.
          setParsed(null);
          setMapping({});
          setNewGuestNames({});
        },
      },
    );
  };

  return (
    <div>
      <Field label={t("import.fileLabel")}>
        <input
          type="file"
          accept=".xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file again fires onChange again.
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </Field>

      {preview.isPending && (
        <p className="text-[13px]" style={hint}>
          {t("import.parsing")}
        </p>
      )}
      {preview.isError && (
        <p role="alert" className="text-[13px]" style={{ color: "var(--clay)" }}>
          {t("import.parseFailed")}
        </p>
      )}
      {done !== null && (
        <p role="status" aria-live="polite" className="mb-2 text-[13px]" style={{ color: "var(--moss-2)" }}>
          {t("import.done", { count: done })}
        </p>
      )}

      {parsed && (
        <>
          <p className="mb-2 text-[13px]" style={hint}>
            {t("import.rowCount", { count: parsed.rows.length })}
            {parsed.warnings.length > 0 && ` · ${t("import.warnings", { count: parsed.warnings.length })}`}
          </p>

          <div className="mb-3 border-t pt-2.5" style={rule}>
            <div className="mb-1.5 text-[13px] font-semibold" style={sectionLabel}>
              {t("import.mapping")}
            </div>
            {parsed.sourceNames.map((name) => (
              <div key={name} className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px]">{name}</span>
                <Select
                  value={mapping[name] ?? (name in newGuestNames ? "__guest__" : "")}
                  onChange={(e) => {
                    if (e.target.value === "__guest__") setGuestMapping(name);
                    else if (e.target.value) setMemberMapping(name, e.target.value);
                  }}
                >
                  <option value="">{t("import.mapUnmapped")}</option>
                  {memberList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nickname}
                    </option>
                  ))}
                  {me.data?.isOwner && <option value="__guest__">{t("import.createGuest", { name })}</option>}
                </Select>
              </div>
            ))}
          </div>

          {commit.isError && (
            <p role="alert" className="mb-2 text-[13px]" style={{ color: "var(--clay)" }}>
              {t("import.failed")}
            </p>
          )}

          <Button className="w-full" disabled={!canConfirm} isLoading={commit.isPending} onClick={onConfirm}>
            {t("import.confirm")}
          </Button>
        </>
      )}
    </div>
  );
}

type Panel = "edit" | "members" | "invite" | "duplicate" | "import" | "export";

/** A labelled run of menu items. The label is announced as the group's name. */
function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="py-1">
      <div id={id} className="px-3.5 pt-1.5 pb-0.5 text-[13px] font-semibold" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function LedgerMenu({ ledger }: { ledger: LedgerSummary }) {
  const navigate = useNavigate();
  const me = useMe();
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

  const item = `chip-press flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-[15px] ${focusRing}`;

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
          className={`grid min-h-11 min-w-11 place-items-center rounded-[6px] transition-colors hover:bg-[var(--paper-sunk)] ${focusRing}`}
          style={{ color: "var(--ink-2)" }}
        >
          <Icon name="more" />
        </button>
        {open && (
          <>
            {/* Catches the tap that means "not this after all". */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="menu"
              aria-label={t("ledger.menu.open")}
              className="menu-in absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-[8px] border py-1"
              style={{ background: "var(--paper)", borderColor: "var(--line)" }}
            >
              <MenuGroup label={t("ledger.menu.groupThis")}>
                <button type="button" role="menuitem" className={item} onClick={() => pick("edit")}>
                  <Icon name="edit" size={18} />
                  {t("ledger.menu.edit")}
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => pick("members")}>
                  <Icon name="users" size={18} />
                  {t("ledger.menu.members")}
                </button>
                {me.data?.accountType !== "restricted" && (
                  <button type="button" role="menuitem" className={item} onClick={() => pick("invite")}>
                    <Icon name="link" size={18} />
                    {t("ledger.menu.invite")}
                  </button>
                )}
              </MenuGroup>
              <MenuGroup label={t("ledgerNav.expenses")}>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    trigger.current?.focus();
                    setOpen(false);
                    navigate(`/ledgers/${ledger.id}/recurring`);
                  }}
                >
                  <Icon name="repeat" size={18} />
                  {t("ledgerNav.recurring")}
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => pick("import")}>
                  <Icon name="upload" size={18} />
                  {t("import.menuLabel")}
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => pick("export")}>
                  <Icon name="download" size={18} />
                  {t("ledger.menu.export")}
                </button>
              </MenuGroup>
              <div className="my-1 border-t" style={rule} />
              {me.data?.accountType !== "restricted" && (
                <button type="button" role="menuitem" className={item} onClick={() => pick("duplicate")}>
                  <Icon name="copy" size={18} />
                  {t("ledger.menu.duplicate")}
                </button>
              )}
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
                <Icon name="archive" size={18} />
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
                <Icon name="trash" size={18} />
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
      <Sheet open={panel === "duplicate"} onOpenChange={() => setPanel(null)} title={t("ledger.menu.duplicate")}>
        <DuplicatePanel
          ledger={ledger}
          onDone={(newLedgerId) => {
            setPanel(null);
            navigate(`/ledgers/${newLedgerId}`);
          }}
        />
      </Sheet>
      <Sheet open={panel === "import"} onOpenChange={() => setPanel(null)} title={t("import.title")}>
        <ImportPanel ledgerId={ledger.id} />
      </Sheet>

      <ExportSheet ledgerId={ledger.id} open={panel === "export"} onClose={() => setPanel(null)} />

      {(lifecycle.isError || remove.isError) && (
        <p role="alert" className="mx-0.5 mb-2 text-[13px]" style={{ color: "var(--clay)" }}>
          {lifecycle.isError ? lifecycleFailure : deleteFailure}
        </p>
      )}

      {confirming === "archive" && (
        <ConfirmDialog
          title={t("confirm.archiveLedger.title")}
          body={t("confirm.archiveLedger.body")}
          confirmLabel={t("confirm.archiveLedger.action")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            lifecycle.mutate("archive");
          }}
        />
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          title={t("confirm.deleteLedger.title", { name: ledger.name })}
          body={t("confirm.deleteLedger.body")}
          confirmLabel={t("confirm.deleteLedger.action")}
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

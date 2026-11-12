import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ScreenSkeleton,
  SectionHeading,
  Skeleton,
} from "~/client/components/ui";
import { api, ApiError } from "~/client/lib/api";
import { qk } from "~/client/lib/queries";
import {
  useAdminUsers,
  useAdminInvites,
  useAdminInstance,
  useCreateRecovery,
  useRevokeCredential,
  useSignOutUser,
  useClearPassword,
  usePromoteUser,
  useRevokeInvite,
  useCategories,
  useSaveCategory,
  useDeleteCategory,
  useMe,
} from "~/client/lib/queries";
import { useCopied } from "~/client/lib/useCopied";
import { t } from "~/client/i18n";

function InstanceSection() {
  const instance = useAdminInstance();
  if (instance.isPending) {
    return (
      <Card>
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-2/3" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  }
  if (instance.error || !instance.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;
  const d = instance.data;
  return (
    <Card>
      <div className="flex items-center justify-between py-1 text-[15px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.rpId")}</span>
        <span className="tnum">{d.rpId}</span>
      </div>
      <p className="mb-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.rpIdFrozen")}
      </p>
      <div className="flex items-center justify-between py-1 text-[15px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.people")}</span>
        <span className="tnum">{d.userCount}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[15px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.ledgers")}</span>
        <span className="tnum">{d.ledgerCount}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[15px]">
        <span style={{ color: "var(--ink-3)" }}>{t("notifications.title")}</span>
        <span>{t(d.pushConfigured ? "admin.on" : "admin.off")}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[15px]">
        <span style={{ color: "var(--ink-3)" }}>{t("recurring.title")}</span>
        <span>{t(d.recurringConfigured ? "admin.on" : "admin.off")}</span>
      </div>
    </Card>
  );
}

/** Re-enrols an EXISTING account on a new device. Bound to this user, so unlike
 *  an invite it cannot create a second account and strand their history. */
function RecoveryRow({ userId }: { userId: string }) {
  const create = useCreateRecovery();
  const [link, setLink] = useState<string | null>(null);
  const copy = useCopied();

  const mint = () =>
    create.mutate(userId, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}/welcome?recovery=${encodeURIComponent(token)}`);
      },
    });

  if (link !== null) {
    return (
      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
        <p
          className="mb-1.5 rounded-[6px] border px-2.5 py-2 text-[13px] break-all"
          style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
        >
          {link}
        </p>
        <Button variant="ghost" size="sm" onClick={() => copy.copy(link)}>
          {t(copy.copied === link ? "ledger.inviteCopied" : "ledger.inviteCopy")}
        </Button>
        <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.recoveryHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
      <Button variant="ghost" size="sm" isLoading={create.isPending} onClick={mint}>
        {t("admin.recovery")}
      </Button>
      {create.isError && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("error.generic")}
        </p>
      )}
    </div>
  );
}

/**
 * The two emergency levers, for a device that walked off or a password that
 * leaked. Neither deletes anything: sign-out ends sessions, clear-password
 * forgets the hash. Passkeys and history survive both, so the way back in is
 * the recovery link above.
 */
function EmergencyRow({ userId, name, hasPassword }: { userId: string; name: string; hasPassword: boolean }) {
  const signOut = useSignOutUser();
  const clearPassword = useClearPassword();
  // Both levers take access away from someone, so both confirm first.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" size="sm" isLoading={signOut.isPending} onClick={() => setConfirmingSignOut(true)}>
          {t("admin.signOutUser")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!hasPassword}
          isLoading={clearPassword.isPending}
          onClick={() => setConfirmingClear(true)}
        >
          {t("admin.clearPassword")}
        </Button>
      </div>
      <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.emergencyHint")}
      </p>
      {signOut.isSuccess && (
        <p role="status" className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.signOutUserDone")}
        </p>
      )}
      {clearPassword.isSuccess && (
        <p role="status" className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.clearPasswordDone")}
        </p>
      )}
      {(signOut.isError || clearPassword.isError) && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("error.generic")}
        </p>
      )}
      {confirmingSignOut && (
        <ConfirmDialog
          title={t("confirm.signOutEverywhere.title", { name })}
          body={t("confirm.signOutEverywhere.body")}
          confirmLabel={t("confirm.signOutEverywhere.action")}
          onCancel={() => setConfirmingSignOut(false)}
          onConfirm={() => {
            setConfirmingSignOut(false);
            signOut.mutate(userId);
          }}
        />
      )}
      {confirmingClear && (
        <ConfirmDialog
          title={t("confirm.clearPassword.title")}
          body={t("admin.clearPasswordConfirm")}
          confirmLabel={t("confirm.clearPassword.action")}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            clearPassword.mutate(userId);
          }}
        />
      )}
    </div>
  );
}

/** Owner-only, one-directional (ADR 0008): promotes a restricted account to
 *  full. There is no demote button because there is no demote route. */
function PromoteRow({ userId, name }: { userId: string; name: string }) {
  const promote = usePromoteUser();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
      <Button variant="danger" size="sm" isLoading={promote.isPending} onClick={() => setConfirming(true)}>
        {t("admin.promote")}
      </Button>
      <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.promoteHint")}
      </p>
      {promote.isSuccess && (
        <p role="status" className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.promoteDone")}
        </p>
      )}
      {promote.isError && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("error.generic")}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t("confirm.promote.title", { name })}
          body={t("admin.promoteHint")}
          confirmLabel={t("confirm.promote.action")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            promote.mutate(userId);
          }}
        />
      )}
    </div>
  );
}

/** Maps the server's refusal codes to a specific reason. A generic "failed"
 *  here would hide the one message that tells the owner what to do next -
 *  settle the balance first. */
function deleteMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "non_zero_position") return t("admin.deleteUserBlocked");
  if (code === "self") return t("admin.deleteUserSelf");
  if (code === "owner") return t("admin.deleteUserOwner");
  return t("admin.deleteUserFailed");
}

function PeopleSection() {
  const qc = useQueryClient();
  const users = useAdminUsers();
  const revoke = useRevokeCredential();
  const [revokedId, setRevokedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ userId: string; credentialId: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [deleted, setDeleted] = useState(false);

  const removeUser = useMutation({
    mutationFn: (userId: string) => api<{ id: string }>(`/api/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleted(true);
      // The panel's own list plus the instance counts both go stale.
      qc.invalidateQueries({ queryKey: qk.adminUsers });
      qc.invalidateQueries({ queryKey: qk.adminInstance });
    },
  });

  if (users.isPending) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="mb-2">
            <div className="flex items-center gap-2.5">
              {/* Same size and radius as the real Avatar, so the list does not jump on load. */}
              <Skeleton className="h-[29px] w-[29px] shrink-0 rounded-[6px]!" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="mt-2.5 h-3 w-2/3" />
          </Card>
        ))}
      </>
    );
  }
  if (users.error || !users.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const doRevoke = () => {
    if (!confirming) return;
    const { userId, credentialId } = confirming;
    revoke.mutate({ userId, credentialId }, { onSuccess: () => setRevokedId(credentialId) });
    setConfirming(null);
  };

  const doDelete = () => {
    if (!deleting) return;
    setDeleted(false);
    removeUser.mutate(deleting.id);
    setDeleting(null);
  };

  return (
    <>
      <p className="mx-0.5 mb-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.peopleBody")}
      </p>
      {users.data.map((u) => (
        <Card key={u.id} className="mb-2">
          <div className="flex items-center gap-2.5">
            <Avatar name={u.displayName} />
            <span className="flex-1 truncate text-[15px] font-medium">{u.displayName}</span>
            {u.isOwner && <Badge>{t("admin.owner")}</Badge>}
            {u.accountType === "restricted" && <Badge>{t("admin.restricted")}</Badge>}
          </div>
          <div
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]"
            style={{ color: "var(--ink-3)" }}
          >
            <span className="truncate">{u.email ?? t("admin.noEmail")}</span>
            <span aria-hidden="true">·</span>
            <span>{t(u.hasPassword ? "admin.hasPassword" : "admin.noPassword")}</span>
          </div>
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
            {u.credentials.length === 0 ? (
              <p className="py-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {t("profile.noDevices")}
              </p>
            ) : (
              u.credentials.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-[15px]">
                  <span>{t("profile.passkey")}</span>
                  {revokedId === c.id ? (
                    <span role="status" className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                      {t("admin.revoked")}
                    </span>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      // Revoking the only passkey locks the account out and the
                      // server refuses it (409). Issue a recovery link instead.
                      disabled={u.credentials.length === 1}
                      isLoading={revoke.isPending}
                      onClick={() => setConfirming({ userId: u.id, credentialId: c.id })}
                    >
                      {t("admin.revoke")}
                    </Button>
                  )}
                </div>
              ))
            )}
            {u.credentials.length === 1 && (
              <p className="pb-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {t("admin.lastCredential")}
              </p>
            )}
          </div>
          <RecoveryRow userId={u.id} />
          <EmergencyRow userId={u.id} name={u.displayName} hasPassword={u.hasPassword} />
          {u.accountType === "restricted" && <PromoteRow userId={u.id} name={u.displayName} />}
          {!u.isOwner && (
            <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
              <Button
                variant="danger"
                size="sm"
                isLoading={removeUser.isPending}
                onClick={() => (setDeleted(false), removeUser.reset(), setDeleting({ id: u.id, name: u.displayName }))}
              >
                {t("admin.deleteUser")}
              </Button>
              <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {t("admin.deleteUserHint")}
              </p>
            </div>
          )}
        </Card>
      ))}

      {removeUser.isError && (
        <p role="alert" className="mx-0.5 mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {deleteMessage(removeUser.error)}
        </p>
      )}
      {deleted && (
        <p role="status" className="mx-0.5 mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.deleteUserDone")}
        </p>
      )}

      {deleting && (
        <ConfirmDialog
          title={t("confirm.deleteAccount.title", { name: deleting.name })}
          body={t("admin.deleteUserHint")}
          confirmLabel={t("confirm.deleteAccount.action")}
          onCancel={() => setDeleting(null)}
          onConfirm={doDelete}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={t("confirm.revokeUserPasskey.title")}
          body={t("confirm.revokeUserPasskey.body")}
          confirmLabel={t("confirm.revokeUserPasskey.action")}
          onCancel={() => setConfirming(null)}
          onConfirm={doRevoke}
        />
      )}
    </>
  );
}

function CategoriesSection() {
  const categories = useCategories();
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  if (categories.isPending) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mb-2 h-11 w-full" />
        ))}
      </>
    );
  }
  if (categories.error || !categories.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !icon.trim()) return;
    save.mutate({ name: name.trim(), icon: icon.trim() }, { onSuccess: () => (setName(""), setIcon("")) });
  };

  const doDelete = () => {
    if (!confirming) return;
    del.mutate(confirming);
    setConfirming(null);
  };

  return (
    <>
      {categories.data.map((c) => (
        <Card key={c.id} className="mb-2 flex items-center justify-between gap-2.5">
          <span className="flex min-w-0 items-center gap-2 text-[15px]">
            <span aria-hidden="true">{c.icon}</span>
            <span className="truncate">{c.name}</span>
          </span>
          {c.isDefault ? (
            <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
              {t("admin.categoryDefault")}
            </span>
          ) : (
            <Button variant="danger" size="sm" isLoading={del.isPending} onClick={() => setConfirming(c.id)}>
              {t("admin.categoryDelete")}
            </Button>
          )}
        </Card>
      ))}

      <Card className="mt-2">
        <form onSubmit={onSubmit}>
          <Field label={t("admin.categoryName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label={t("admin.categoryIcon")}>
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} required maxLength={8} />
          </Field>
          <Button type="submit" isLoading={save.isPending}>
            {t("admin.categoryAdd")}
          </Button>
        </form>
      </Card>

      {confirming && (
        <ConfirmDialog
          title={t("confirm.deleteCategory.title")}
          confirmLabel={t("confirm.deleteCategory.action")}
          onCancel={() => setConfirming(null)}
          onConfirm={doDelete}
        />
      )}
    </>
  );
}

/** An INSTANCE invite - it creates an account without joining any ledger.
 *  Same shape as the ledger InviteRow: the token comes back ONCE and lives in
 *  component state only, because an invite is a bearer credential and must
 *  never be re-fetchable. */
function InstanceInviteCard() {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const copy = useCopied();

  const create = useMutation({
    mutationFn: () => api<{ token: string; expiresAt: number }>("/api/admin/invites", { method: "POST" }),
    onSuccess: ({ token }) => {
      setLink(`${window.location.origin}/welcome?invite=${encodeURIComponent(token)}`);
      qc.invalidateQueries({ queryKey: qk.adminInvites });
    },
  });

  return (
    <Card className="mb-2">
      <div className="mb-2 text-[15px] font-medium">{t("admin.inviteInstance")}</div>
      {link === null ? (
        <>
          <Button variant="ghost" size="sm" isLoading={create.isPending} onClick={() => create.mutate()}>
            {t("admin.inviteInstanceCreate")}
          </Button>
          {create.isError && (
            <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
              {t("admin.inviteFailed")}
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
          <Button variant="ghost" size="sm" onClick={() => copy.copy(link)}>
            {t(copy.copied === link ? "admin.inviteCopied" : "admin.inviteCopy")}
          </Button>
        </>
      )}
      <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.inviteInstanceHint")}
      </p>
    </Card>
  );
}

function InvitesSection() {
  const invites = useAdminInvites();
  const revoke = useRevokeInvite();
  const [confirming, setConfirming] = useState<string | null>(null);

  if (invites.isPending) {
    return (
      <>
        {[0, 1].map((i) => (
          <Skeleton key={i} className="mb-2 h-14 w-full" />
        ))}
      </>
    );
  }
  if (invites.error || !invites.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const doRevoke = () => {
    if (!confirming) return;
    revoke.mutate(confirming);
    setConfirming(null);
  };

  if (invites.data.length === 0) {
    return (
      <p className="mx-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.invitesNone")}
      </p>
    );
  }

  return (
    <>
      {invites.data.map((inv) => {
        const hours = Math.max(0, Math.round((inv.expiresAt - Date.now()) / 3_600_000));
        return (
          <Card key={inv.id} className="mb-2 flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              {/* Null ledgerName means an instance invite - it joins no ledger,
                  so its scope has to be spelled out rather than left blank. */}
              <div className="truncate text-[15px] font-medium">{inv.ledgerName ?? t("admin.inviteScopeInstance")}</div>
              <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                {t("admin.expiresIn", { hours })}
              </div>
            </div>
            <Button variant="danger" size="sm" isLoading={revoke.isPending} onClick={() => setConfirming(inv.id)}>
              {t("admin.inviteRevoke")}
            </Button>
          </Card>
        );
      })}

      {confirming && (
        <ConfirmDialog
          title={t("confirm.revokeInvite.title")}
          confirmLabel={t("confirm.revokeInvite.action")}
          onCancel={() => setConfirming(null)}
          onConfirm={doRevoke}
        />
      )}
    </>
  );
}

export default function AdminPanel() {
  const me = useMe();
  const back = "/you";

  if (me.isPending)
    return (
      <>
        <PageHeader title={t("admin.title")} back={back} />
        <ScreenSkeleton />
      </>
    );
  if (me.error || !me.data)
    return (
      <>
        <PageHeader title={t("admin.title")} back={back} />
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      </>
    );
  if (!me.data.isOwner)
    return (
      <>
        <PageHeader title={t("admin.title")} back={back} />
        <EmptyState title={t("admin.onlyOwner")} />
      </>
    );

  return (
    <>
      <PageHeader title={t("admin.title")} back={back} />

      <SectionHeading>{t("admin.instance")}</SectionHeading>
      <InstanceSection />

      <SectionHeading>{t("admin.people")}</SectionHeading>
      <PeopleSection />

      <SectionHeading>{t("admin.categories")}</SectionHeading>
      <CategoriesSection />

      <SectionHeading>{t("admin.invites")}</SectionHeading>
      <InstanceInviteCard />
      <InvitesSection />
    </>
  );
}

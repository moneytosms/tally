import { useState, type FormEvent } from "react";
import { Avatar, Button, EmptyState, Field, Input } from "~/client/components/ui";
import {
  useAdminUsers,
  useAdminInvites,
  useAdminInstance,
  useCreateRecovery,
  useRevokeCredential,
  useRevokeInvite,
  useCategories,
  useSaveCategory,
  useDeleteCategory,
  useMe,
} from "~/client/lib/queries";
import { t } from "~/client/i18n";

const Section = ({ title }: { title: string }) => (
  <div className="mx-0.5 mt-5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
    {title}
  </div>
);

const card = { background: "var(--paper-2)", borderColor: "var(--line)" } as const;

function InstanceSection() {
  const instance = useAdminInstance();
  if (instance.isPending) return null;
  if (instance.error || !instance.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;
  const d = instance.data;
  return (
    <div className="rounded-[7px] border px-3.5 py-3.5" style={card}>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.rpId")}</span>
        <span className="tnum">{d.rpId}</span>
      </div>
      <p className="mb-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.rpIdFrozen")}
      </p>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.people")}</span>
        <span className="tnum">{d.userCount}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span style={{ color: "var(--ink-3)" }}>{t("admin.ledgers")}</span>
        <span className="tnum">{d.ledgerCount}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span style={{ color: "var(--ink-3)" }}>{t("notifications.title")}</span>
        <span>{d.pushConfigured ? "✓" : "—"}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span style={{ color: "var(--ink-3)" }}>{t("recurring.title")}</span>
        <span>{d.recurringConfigured ? "✓" : "—"}</span>
      </div>
    </div>
  );
}

/** Re-enrols an EXISTING account on a new device. Bound to this user, so unlike
 *  an invite it cannot create a second account and strand their history. */
function RecoveryRow({ userId }: { userId: string }) {
  const create = useCreateRecovery();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = () =>
    create.mutate(userId, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}/welcome?recovery=${encodeURIComponent(token)}`);
        setCopied(false);
      },
    });

  if (link !== null) {
    return (
      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
        <p className="mb-1.5 rounded-[6px] border px-2.5 py-2 text-[11.5px] break-all" style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}>
          {link}
        </p>
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
        <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("admin.recoveryHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
      <Button variant="ghost" size="sm" disabled={create.isPending} onClick={mint}>
        {t("admin.recovery")}
      </Button>
      {create.isError && (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--clay)" }}>
          {t("error.generic")}
        </p>
      )}
    </div>
  );
}

function PeopleSection() {
  const users = useAdminUsers();
  const revoke = useRevokeCredential();
  const [revokedId, setRevokedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ userId: string; credentialId: string } | null>(null);

  if (users.isPending) return null;
  if (users.error || !users.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const doRevoke = () => {
    if (!confirming) return;
    const { userId, credentialId } = confirming;
    revoke.mutate(
      { userId, credentialId },
      { onSuccess: () => setRevokedId(credentialId) },
    );
    setConfirming(null);
  };

  return (
    <>
      <p className="mx-0.5 mb-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("admin.peopleBody")}
      </p>
      {users.data.map((u) => (
        <div key={u.id} className="mb-2 rounded-[7px] border px-3.5 py-3" style={card}>
          <div className="flex items-center gap-2.5">
            <Avatar name={u.displayName} />
            <span className="flex-1 truncate text-[14.5px] font-medium">{u.displayName}</span>
            {u.isOwner && (
              <span
                className="rounded-[4px] px-1.5 py-0.5 text-[10.5px] tracking-[0.08em] uppercase"
                style={{ background: "var(--moss-wash)", color: "var(--moss-2)" }}
              >
                {t("admin.owner")}
              </span>
            )}
          </div>
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
            {u.credentials.length === 0 ? (
              <p className="py-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                {t("profile.noDevices")}
              </p>
            ) : (
              u.credentials.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                  <span>{t("profile.passkey")}</span>
                  {revokedId === c.id ? (
                    <span role="status" className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                      {t("admin.revoked")}
                    </span>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      // Revoking the only passkey locks the account out and the
                      // server refuses it (409). Issue a recovery link instead.
                      disabled={revoke.isPending || u.credentials.length === 1}
                      onClick={() => setConfirming({ userId: u.id, credentialId: c.id })}
                    >
                      {t("admin.revoke")}
                    </Button>
                  )}
                </div>
              ))
            )}
            {u.credentials.length === 1 && (
              <p className="pb-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {t("admin.lastCredential")}
              </p>
            )}
          </div>
          <RecoveryRow userId={u.id} />
        </div>
      ))}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgb(0 0 0 / 38%)" }}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-[10px] border p-4" style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
            <p className="mb-3 text-[14px]">{t("admin.revoke")}?</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t("action.cancel")}
              </Button>
              <Button variant="danger" onClick={doRevoke}>
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        </div>
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

  if (categories.isPending) return null;
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
        <div key={c.id} className="mb-2 flex items-center justify-between gap-2.5 rounded-[7px] border px-3.5 py-2.5" style={card}>
          <span className="flex min-w-0 items-center gap-2 text-[14px]">
            <span aria-hidden="true">{c.icon}</span>
            <span className="truncate">{c.name}</span>
          </span>
          {c.isDefault ? (
            <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {t("admin.categoryDefault")}
            </span>
          ) : (
            <Button variant="danger" size="sm" disabled={del.isPending} onClick={() => setConfirming(c.id)}>
              {t("admin.categoryDelete")}
            </Button>
          )}
        </div>
      ))}

      <form onSubmit={onSubmit} className="mt-2 rounded-[7px] border px-3.5 py-3.5" style={card}>
        <Field label={t("admin.categoryName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label={t("admin.categoryIcon")}>
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} required maxLength={8} />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t("admin.categoryAdd")}
        </Button>
      </form>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgb(0 0 0 / 38%)" }}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-[10px] border p-4" style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
            <p className="mb-3 text-[14px]">{t("admin.categoryDelete")}?</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t("action.cancel")}
              </Button>
              <Button variant="danger" onClick={doDelete}>
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InvitesSection() {
  const invites = useAdminInvites();
  const revoke = useRevokeInvite();
  const [confirming, setConfirming] = useState<string | null>(null);

  if (invites.isPending) return null;
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
          <div key={inv.id} className="mb-2 flex items-center justify-between gap-2.5 rounded-[7px] border px-3.5 py-3" style={card}>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium">{inv.ledgerName}</div>
              <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {t("admin.expiresIn", { hours })}
              </div>
            </div>
            <Button variant="danger" size="sm" disabled={revoke.isPending} onClick={() => setConfirming(inv.id)}>
              {t("admin.inviteRevoke")}
            </Button>
          </div>
        );
      })}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgb(0 0 0 / 38%)" }}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-[10px] border p-4" style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
            <p className="mb-3 text-[14px]">{t("admin.inviteRevoke")}?</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t("action.cancel")}
              </Button>
              <Button variant="danger" onClick={doRevoke}>
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminPanel() {
  const me = useMe();

  if (me.isPending) return null;
  if (me.error || !me.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;
  if (!me.data.isOwner) return <EmptyState title={t("admin.onlyOwner")} body="" />;

  return (
    <>
      <header className="mb-3">
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("admin.title")}</h1>
      </header>

      <Section title={t("admin.instance")} />
      <InstanceSection />

      <Section title={t("admin.people")} />
      <PeopleSection />

      <Section title={t("admin.categories")} />
      <CategoriesSection />

      <Section title={t("admin.invites")} />
      <InvitesSection />
    </>
  );
}

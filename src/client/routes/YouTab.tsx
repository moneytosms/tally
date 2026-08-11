import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, EmptyState, Field, Input } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { useLedgers, useMe, useUpdateProfile } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const Section = ({ title }: { title: string }) => (
  <div className="mx-0.5 mt-5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
    {title}
  </div>
);

export function YouTab() {
  const me = useMe();
  const ledgers = useLedgers();
  const save = useUpdateProfile();
  const [draft, setDraft] = useState<{ displayName: string; vpa: string } | null>(null);

  if (me.isPending) return null;
  if (me.error || !me.data) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  // Only ever this user's own VPA. Another member's VPA is never rendered here.
  const form = draft ?? { displayName: me.data.displayName, vpa: me.data.vpa ?? "" };
  const archived = (ledgers.data ?? []).filter((l) => l.archivedAt !== null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ displayName: form.displayName, vpa: form.vpa.trim() === "" ? null : form.vpa.trim() });
  };

  return (
    <>
      <header className="mb-3">
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("tabs.you")}</h1>
      </header>

      <form onSubmit={onSubmit} className="rounded-[7px] border px-3.5 py-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <Field label={t("profile.displayName")}>
          <Input value={form.displayName} onChange={(e) => setDraft({ ...form, displayName: e.target.value })} required maxLength={80} />
        </Field>
        <Field label={t("profile.vpa")} error={save.error ? t("profile.vpaInvalid") : undefined}>
          <Input
            value={form.vpa}
            onChange={(e) => setDraft({ ...form, vpa: e.target.value })}
            placeholder="name@bank"
            inputMode="email"
            autoComplete="off"
          />
        </Field>
        <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("profile.vpaVisibility")}
        </p>
        <Button type="submit" disabled={save.isPending}>
          {t("action.save")}
        </Button>
        {save.isSuccess && !draft && <span className="sr-only">{t("profile.saved")}</span>}
      </form>

      <Section title={t("profile.devices")} />
      <div className="rounded-[7px] border px-3.5 py-2" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        {me.data.credentials.length === 0 ? (
          <p className="py-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("profile.noDevices")}
          </p>
        ) : (
          me.data.credentials.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <span className="truncate">{t("profile.passkey")}</span>
              <span className="tnum text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {new Date(c.lastUsedAt ?? c.createdAt).toLocaleDateString("en-IN")}
              </span>
            </div>
          ))
        )}
      </div>

      <Section title={t("profile.archived")} />
      {archived.length === 0 ? (
        <p className="mx-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("profile.noArchived")}
        </p>
      ) : (
        archived.map((l) => (
          <Link
            key={l.id}
            to={`/ledgers/${l.id}`}
            className={`mb-2 block truncate rounded-[7px] border px-3.5 py-3 text-[14.5px] ${focusRing}`}
            style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
          >
            {l.name}
          </Link>
        ))
      )}

      <Section title={t("profile.export")} />
      <p className="mx-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("profile.exportSoon")}
      </p>
    </>
  );
}

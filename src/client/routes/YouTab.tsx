import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Input, ScreenSkeleton } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { api } from "~/client/lib/api";
import { qk, useLedgers, useMe, useUpdateProfile } from "~/client/lib/queries";
import { currentPushState, disablePush, enablePush, type PushState } from "~/client/lib/push";
import { PasswordSection } from "~/client/components/PasswordSection";
import { ThemePicker } from "~/client/components/ThemePicker";
import { t } from "~/client/i18n";

// One date format for the whole app: en-IN, day first. Never toLocaleDateString
// with no locale, which follows the browser and disagrees with every other screen.
const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const pushMessage: Record<PushState["status"], string> = {
  on: "notifications.enabled",
  off: "notifications.body",
  unsupported: "notifications.unsupported",
  denied: "notifications.denied",
  "needs-install": "notifications.iosHint",
  unavailable: "notifications.unavailable",
};

function NotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    currentPushState().then(setState);
  }, []);

  if (!state) return null;

  const toggle = async () => {
    setPending(true);
    try {
      setState(state.status === "on" ? await disablePush() : await enablePush());
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-[7px] border px-3.5 py-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      <p role="status" className="mb-2.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t(pushMessage[state.status])}
      </p>
      {(state.status === "on" || state.status === "off") && (
        <Button variant={state.status === "on" ? "ghost" : "primary"} size="sm" disabled={pending} onClick={toggle}>
          {t(state.status === "on" ? "notifications.disable" : "notifications.enable")}
        </Button>
      )}
    </div>
  );
}

/** Enrols an ADDITIONAL passkey on the session that is already signed in.
 *  Without this the only enrolment path is Onboarding, which is unreachable
 *  once you have a session - leaving a one-device account one revoke from
 *  being locked out. Picking "use a phone or tablet" in the browser prompt is
 *  what gets a synced credential onto a second device. */
function AddPasskey({ displayName }: { displayName: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(false);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/register/options",
        { method: "POST", body: JSON.stringify({ displayName }) },
      );
      const attestation = await startRegistration({ optionsJSON });
      await api("/api/auth/register/verify", { method: "POST", body: JSON.stringify({ response: attestation }) });
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
      <Button variant="ghost" size="sm" disabled={busy} onClick={add}>
        {t("profile.addPasskey")}
      </Button>
      <p className="mt-2 text-[11.5px]" style={{ color: error ? "var(--clay)" : "var(--ink-3)" }}>
        {t(error ? "error.generic" : "profile.addPasskeyHint")}
      </p>
    </div>
  );
}

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

  if (me.isPending) return <ScreenSkeleton />;
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
          // Not a quiet list item: this is the state where closing the tab can
          // cost the account, so it is styled as the warning it is.
          <p
            role="alert"
            className="my-2 rounded-[6px] border px-3 py-2.5 text-[13px] leading-relaxed"
            style={{ borderColor: "var(--clay)", background: "var(--clay-wash)", color: "var(--clay)" }}
          >
            {t("profile.noDevicesWarning")}
          </p>
        ) : (
          me.data.credentials.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <span className="truncate">
                {t("profile.passkey")}{" "}
                <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {t("profile.passkeyAdded", { date: dayFormat.format(c.createdAt) })}
                </span>
              </span>
              <span className="tnum flex-none text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                {c.lastUsedAt === null
                  ? t("profile.passkeyNeverUsed")
                  : t("profile.passkeyLastUsed", { date: dayFormat.format(c.lastUsedAt) })}
              </span>
            </div>
          ))
        )}
        <AddPasskey displayName={me.data.displayName} />
      </div>

      <Section title={t("profile.password")} />
      <PasswordSection />

      <Section title={t("profile.theme")} />
      <ThemePicker />

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

      <Section title={t("notifications.title")} />
      <NotificationsSection />

      <Section title={t("profile.export")} />
      <div className="rounded-[7px] border px-3.5 py-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
        <p className="mb-2.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("export.body")}
        </p>
        <a
          href="/api/export.csv"
          download
          className={`inline-flex min-h-11 items-center text-[14px] ${focusRing}`}
          style={{ color: "var(--moss-2)" }}
        >
          {t("export.allCsv")} →
        </a>
      </div>

      {me.data.isOwner && (
        <>
          <Section title={t("admin.title")} />
          <Link
            to="/you/admin"
            className={`mb-2 block rounded-[7px] border px-3.5 py-3 text-[14.5px] ${focusRing}`}
            style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
          >
            {t("admin.open")} →
          </Link>
        </>
      )}
    </>
  );
}

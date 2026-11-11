import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ScreenSkeleton,
  pushToast,
} from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { api, ApiError } from "~/client/lib/api";
import { qk, useLedgers, useLogout, useMe, useRevokeOwnCredential, useUpdateProfile } from "~/client/lib/queries";
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
  const [failed, setFailed] = useState(false);

  // A failed state lookup still shows the section, with the same error line as a
  // failed enable, rather than making the whole section vanish.
  useEffect(() => {
    currentPushState().then(setState, () => setFailed(true));
  }, []);

  if (!state && !failed) return null;

  // Only enabling can fail with a message about turning notifications on.
  // Disabling keeps its old behaviour.
  const enable = async () => {
    setPending(true);
    setFailed(false);
    try {
      setState(await enablePush());
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const disable = async () => {
    setPending(true);
    try {
      setState(await disablePush());
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="rounded-[7px] border px-3.5 py-3.5"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      {state && (
        <p role="status" className="mb-2.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t(pushMessage[state.status])}
        </p>
      )}
      {failed && (
        <p role="alert" className="mb-2.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("notifications.enableFailed")}
        </p>
      )}
      {(state?.status === "on" || state?.status === "off") && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={state.status === "on" ? disable : enable}>
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
      <p className="mt-2 text-[13px]" style={{ color: error ? "var(--clay)" : "var(--ink-3)" }}>
        {t(error ? "error.generic" : "profile.addPasskeyHint")}
      </p>
    </div>
  );
}

/** Self-service revoke of one of the caller's own passkeys. Disabled on the
 *  last remaining one - the server refuses that too (409, `last_credential`),
 *  but disabling here means the confirm dialog never even offers it. */
function RevokeCredential({ credentialId, disabled }: { credentialId: string; disabled: boolean }) {
  const revoke = useRevokeOwnCredential();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span role="status" className="text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("profile.revoked")}
      </span>
    );
  }

  return (
    <>
      <Button variant="danger" size="sm" disabled={disabled || revoke.isPending} onClick={() => setConfirming(true)}>
        {t("profile.revoke")}
      </Button>
      {revoke.isError && (
        <span role="alert" className="text-[13px]" style={{ color: "var(--clay)" }}>
          {t("profile.revokeFailed")}
        </span>
      )}
      {confirming && (
        <ConfirmDialog
          title={t("confirm.revokePasskey.title")}
          body={t("confirm.revokePasskey.body")}
          confirmLabel={t("confirm.revokePasskey.action")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            revoke.mutate(credentialId, { onSuccess: () => setDone(true) });
          }}
        />
      )}
    </>
  );
}

/** Ends this session on this device. Every other passkey, the password and
 *  every other session are untouched - this is the self-serve counterpart to
 *  the owner's "sign out everywhere" emergency lever. */
function SignOutSection() {
  const logout = useLogout();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className="rounded-[7px] border px-3.5 py-3.5"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      <Button variant="danger" size="sm" disabled={logout.isPending} onClick={() => setConfirming(true)}>
        {t("profile.signOut")}
      </Button>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {t("profile.signOutHint")}
      </p>
      {logout.isError && (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
          {t("error.generic")}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t("confirm.signOut.title")}
          confirmLabel={t("confirm.signOut.action")}
          danger={false}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            logout.mutate(undefined, { onSuccess: () => navigate("/welcome", { replace: true }) });
          }}
        />
      )}
    </div>
  );
}

const Section = ({ title }: { title: string }) => (
  <div className="mx-0.5 mt-5 mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
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

  // The server answers a bad profile body with 400 `invalid` and does not say which
  // field, so the VPA hint is shown for that code only. Anything else is a plain failure.
  const saveInvalid = save.error instanceof ApiError && save.error.code === "invalid";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { displayName: form.displayName, vpa: form.vpa.trim() === "" ? null : form.vpa.trim() },
      {
        // Back to the server's copy, so later server-side changes reach the form.
        onSuccess: () => {
          setDraft(null);
          pushToast(t("profile.saved"), "success");
        },
      },
    );
  };

  // Typing after a failed save makes that failure stale. Only reset on error, so
  // typing during an in-flight save does not drop its callbacks.
  const edited = () => {
    if (save.isError) save.reset();
  };

  return (
    <>
      <PageHeader title={t("tabs.you")} />

      <form
        onSubmit={onSubmit}
        className="rounded-[7px] border px-3.5 py-3.5"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
        <Field label={t("profile.displayName")}>
          <Input
            value={form.displayName}
            onChange={(e) => {
              edited();
              setDraft({ ...form, displayName: e.target.value });
            }}
            required
            maxLength={80}
          />
        </Field>
        <Field label={t("profile.vpa")} error={saveInvalid ? t("profile.vpaInvalid") : undefined}>
          <Input
            value={form.vpa}
            onChange={(e) => {
              edited();
              setDraft({ ...form, vpa: e.target.value });
            }}
            placeholder="name@bank"
            inputMode="email"
            autoComplete="off"
          />
        </Field>
        <p className="mb-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("profile.vpaVisibility")}
        </p>
        <Button type="submit" disabled={save.isPending}>
          {t("action.save")}
        </Button>
        {save.isError && !saveInvalid && (
          <p role="alert" className="mt-2 text-[13px]" style={{ color: "var(--clay)" }}>
            {t("error.generic")}
          </p>
        )}
      </form>

      <Section title={t("profile.devices")} />
      <div
        className="rounded-[7px] border px-3.5 py-2"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
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
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
              <span className="truncate">
                {t("profile.passkey")}{" "}
                <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                  {t("profile.passkeyAdded", { date: dayFormat.format(c.createdAt) })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tnum flex-none text-[13px]" style={{ color: "var(--ink-3)" }}>
                  {c.lastUsedAt === null
                    ? t("profile.passkeyNeverUsed")
                    : t("profile.passkeyLastUsed", { date: dayFormat.format(c.lastUsedAt) })}
                </span>
                <RevokeCredential credentialId={c.id} disabled={me.data.credentials.length === 1} />
              </span>
            </div>
          ))
        )}
        {me.data.credentials.length === 1 && (
          <p className="pb-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("profile.lastCredential")}
          </p>
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
            className={`mb-2 block truncate rounded-[7px] border px-3.5 py-3 text-[15px] ${focusRing}`}
            style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
          >
            {l.name}
          </Link>
        ))
      )}

      <Section title={t("notifications.title")} />
      <NotificationsSection />

      <Section title={t("profile.export")} />
      <div
        className="rounded-[7px] border px-3.5 py-3.5"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
        <p className="mb-2.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("export.body")}
        </p>
        <a
          href="/api/export.csv"
          download
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[7px] border px-3 text-[14px] font-medium ${focusRing}`}
          style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
        >
          {t("export.allCsv")}
        </a>
      </div>

      {me.data.isOwner && (
        <Link
          to="/you/admin"
          className={`mt-5 mb-2 block rounded-[7px] border px-3.5 py-3 text-[15px] ${focusRing}`}
          style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
        >
          {t("admin.open")}
        </Link>
      )}

      <SignOutSection />
    </>
  );
}

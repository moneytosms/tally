import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "~/client/components/ui";
import { api, ApiError } from "~/client/lib/api";
import { qk, useMe } from "~/client/lib/queries";
import { t } from "~/client/i18n";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

/** In-app WebViews have no WebAuthn and fail SILENTLY. Detect before showing the
 *  passkey step and offer an explicit way out - this is mandatory, not an edge case. */
function usePlatformAuthenticator() {
  const [state, setState] = useState<"checking" | "available" | "unavailable">("checking");
  useEffect(() => {
    const pkc = window.PublicKeyCredential;
    if (typeof pkc !== "function" || typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
      setState("unavailable");
      return;
    }
    pkc
      .isUserVerifyingPlatformAuthenticatorAvailable()
      .then((ok) => setState(ok ? "available" : "unavailable"))
      .catch(() => setState("unavailable"));
  }, []);
  return state;
}

export function Onboarding() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");
  // Recovery re-enrols an account that already exists, so there is no name to
  // ask for - go straight to the passkey step.
  const recoveryToken = params.get("recovery");
  const authenticator = usePlatformAuthenticator();

  const [step, setStep] = useState<"name" | "passkey" | "vpa">(recoveryToken ? "passkey" : "name");
  const [owner, setOwner] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [vpa, setVpa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Registration signs you in, so `me.data` becomes truthy BEFORE the VPA step gets
  // to render. Without the step check that redirect fires first and the VPA prompt
  // is unreachable for every new account.
  if (me.data && step !== "vpa") return <Navigate to="/" replace />;

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === "offline") return setError(t("error.network"));
    // 403 on the registration path means one thing only: no invite, no unclaimed
    // instance. "Something went wrong" leaves the reader with nowhere to go.
    if (e instanceof ApiError && e.status === 403) return setError(t("onboarding.closedInstance"));
    setError(t("error.generic"));
  };

  const registerPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      if (owner) await api("/api/auth/bootstrap", { method: "POST", body: JSON.stringify({ secret, displayName }) });
      const optionsJSON = await api<RegistrationOptions>("/api/auth/register/options", {
        method: "POST",
        // displayName is ignored by the server on the recovery path - the
        // account already has one - but the schema still requires a string.
        body: JSON.stringify({ displayName: displayName || "-", inviteToken, recoveryToken }),
      });
      const attestation = await startRegistration({ optionsJSON });
      await api("/api/auth/register/verify", {
        method: "POST",
        body: JSON.stringify({ displayName, inviteToken, response: attestation }),
      });
      if (inviteToken) await api(`/api/invites/${inviteToken}/accept`, { method: "POST" });
      // Step BEFORE the invalidate: refetching `me` re-runs the redirect guard above.
      setStep("vpa");
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /** Returning user. Credentials are discoverable (residentKey: "required"), so
   *  the authenticator picks the account - nothing is typed and no display name
   *  is involved. Without this the only path off this screen is enrolment. */
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<AuthenticationOptions>("/api/auth/login/options", { method: "POST" });
      const assertion = await startAuthentication({ optionsJSON });
      await api("/api/auth/login/verify", { method: "POST", body: JSON.stringify({ response: assertion }) });
      // Someone who already has an account can still be invited to a new ledger.
      // Without this the invite is silently dropped the moment they sign in.
      if (inviteToken) await api(`/api/invites/${inviteToken}/accept`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate("/", { replace: true });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const saveVpa = async (skip: boolean) => {
    setBusy(true);
    try {
      if (!skip && vpa.trim() !== "") await api("/api/me", { method: "PATCH", body: JSON.stringify({ vpa: vpa.trim() }) });
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate("/", { replace: true });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const onName = (e: FormEvent) => {
    e.preventDefault();
    // `required` alone leaves the button looking live and doing nothing when the
    // native bubble is suppressed. Say it in the page.
    if (displayName.trim() === "") return setError(t("onboarding.nameRequired"));
    if (owner && secret.trim() === "") return setError(t("onboarding.secretRequired"));
    setError(null);
    setStep("passkey");
  };

  return (
    <div className="paper-ground h-full overflow-auto">
      <div className="relative z-10 mx-auto w-full max-w-[420px] px-5 py-10">
        <h1 className="serif mb-1 text-[26px] tracking-[-0.01em]">{t("onboarding.title")}</h1>
        <p className="mb-7 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t(inviteToken ? "onboarding.invitedSubtitle" : "onboarding.subtitle")}
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded-[6px] border px-3 py-2 text-[13px]" style={{ borderColor: "var(--clay)", background: "var(--clay-wash)", color: "var(--clay)" }}>
            {error}
          </p>
        )}

        {step === "name" && (
          <>
            <Button className="w-full" onClick={signIn} disabled={busy}>
              {t("onboarding.signIn")}
            </Button>
            <p className="mt-2 mb-5 text-center text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {t(inviteToken ? "onboarding.signInHintInvited" : "onboarding.signInHint")}
            </p>
            <div className="mb-5 border-t" style={{ borderColor: "var(--line)" }} />
          </>
        )}

        {step === "name" && (
          // noValidate: `onName` reports problems in the page. Left to the native
          // bubble, a suppressed prompt makes Continue look broken.
          <form onSubmit={onName} noValidate>
            <Field label={t("profile.displayName")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} autoFocus />
            </Field>
            {owner && (
              <Field label={t("onboarding.bootstrapSecret")}>
                <Input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" required autoComplete="off" />
              </Field>
            )}
            <Button type="submit" className="w-full">
              {t("action.continue")}
            </Button>
            {/* Someone following an invite is joining an instance that already has
                an owner, so the claim path is noise on that screen. */}
            {!owner && !inviteToken && (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setOwner(true)}>
                {t("onboarding.iRunThis")}
              </Button>
            )}
          </form>
        )}

        {step === "passkey" && authenticator === "checking" && (
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("onboarding.checking")}
          </p>
        )}

        {step === "passkey" && authenticator === "unavailable" && (
          <div>
            <h2 className="serif mb-2 text-[18px]">{t("onboarding.noWebauthnTitle")}</h2>
            <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {t("onboarding.noWebauthnBody")}
            </p>
            <p className="mb-4 rounded-[6px] border px-3 py-2 text-[12px] break-all" style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}>
              {window.location.href}
            </p>
            <Button variant="ghost" className="w-full" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
              {t("onboarding.copyLink")}
            </Button>
          </div>
        )}

        {step === "passkey" && authenticator === "available" && (
          <div>
            <h2 className="serif mb-2 text-[18px]">{t("onboarding.passkeyTitle")}</h2>
            <p className="mb-4 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {t("onboarding.passkeyBody")}
            </p>
            <Button className="w-full" onClick={registerPasskey} disabled={busy}>
              {t("onboarding.createPasskey")}
            </Button>
          </div>
        )}

        {step === "vpa" && (
          <div>
            <h2 className="serif mb-2 text-[18px]">{t("onboarding.vpaTitle")}</h2>
            <p className="mb-4 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {t("onboarding.vpaBody")}
            </p>
            <Field label={t("profile.vpa")}>
              <Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@bank" autoComplete="off" />
            </Field>
            <Button className="w-full" onClick={() => saveVpa(false)} disabled={busy}>
              {t("action.save")}
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => saveVpa(true)} disabled={busy}>
              {t("action.skip")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

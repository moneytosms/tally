import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "~/client/components/ui";
import { api, ApiError } from "~/client/lib/api";
import { qk, useMe } from "~/client/lib/queries";
import { t } from "~/client/i18n";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

/** In-app WebViews have no WebAuthn and fail SILENTLY. Detect before showing the
 *  passkey step and offer an explicit way out — this is mandatory, not an edge case. */
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
  const authenticator = usePlatformAuthenticator();

  const [step, setStep] = useState<"name" | "passkey" | "vpa">("name");
  const [owner, setOwner] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [vpa, setVpa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.data) return <Navigate to="/" replace />;

  const fail = (e: unknown) =>
    setError(e instanceof ApiError && e.code === "offline" ? t("error.network") : t("error.generic"));

  const registerPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      if (owner) await api("/api/auth/bootstrap", { method: "POST", body: JSON.stringify({ secret, displayName }) });
      const optionsJSON = await api<RegistrationOptions>("/api/auth/register/options", {
        method: "POST",
        body: JSON.stringify({ displayName, inviteToken }),
      });
      const attestation = await startRegistration({ optionsJSON });
      await api("/api/auth/register/verify", {
        method: "POST",
        body: JSON.stringify({ displayName, inviteToken, response: attestation }),
      });
      if (inviteToken) await api(`/api/invites/${inviteToken}/accept`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: qk.me });
      setStep("vpa");
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
    setStep("passkey");
  };

  return (
    <div className="paper-ground flex min-h-dvh flex-col">
      <div className="relative z-10 mx-auto w-full max-w-[420px] px-5 py-10">
        <h1 className="serif mb-1 text-[26px] tracking-[-0.01em]">{t("onboarding.title")}</h1>
        <p className="mb-7 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("onboarding.subtitle")}
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded-[6px] border px-3 py-2 text-[13px]" style={{ borderColor: "var(--clay)", background: "var(--clay-wash)", color: "var(--clay)" }}>
            {error}
          </p>
        )}

        {step === "name" && (
          <form onSubmit={onName}>
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
            {!owner && (
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

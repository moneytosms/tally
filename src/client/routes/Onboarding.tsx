import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "~/client/components/ui";
import { api } from "~/client/lib/api";
import { qk, useMe } from "~/client/lib/queries";
import { classifyAuthError, isEmbeddedIosBrowser, plainFailure, type AuthFailure } from "~/client/lib/passkey";
import { t } from "~/client/i18n";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

/** `getClientCapabilities` is newer than the DOM types here and absent on most
 *  of the browsers this matters for, so it is read defensively. */
type ClientCapabilities = { passkeyPlatformAuthenticator?: boolean };

/** In-app WebViews have no WebAuthn and fail SILENTLY. Detect before showing the
 *  passkey step and offer an explicit way out - this is mandatory, not an edge case.
 *
 *  Two signals, per docs/research/passkeys.md §6. `isUVPAA()` alone is wrong in
 *  both directions: it went false on iOS 26.2 for every WKWebView-backed browser
 *  (Chrome, Firefox and Edge on iOS), and it says nothing about a device that has
 *  no local authenticator but can still use a phone over hybrid. So availability
 *  is either signal, not both - a false "unavailable" is a locked door, and the
 *  ceremony's own error handles the case where the optimism was misplaced. */
function usePlatformAuthenticator() {
  const [state, setState] = useState<"checking" | "available" | "unavailable">("checking");
  useEffect(() => {
    const pkc = window.PublicKeyCredential;
    if (typeof pkc !== "function" || typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
      setState("unavailable");
      return;
    }
    const capabilities = (pkc as unknown as { getClientCapabilities?: () => Promise<ClientCapabilities> })
      .getClientCapabilities;
    Promise.all([
      pkc.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false),
      capabilities ? capabilities.call(pkc).catch(() => null) : Promise.resolve(null),
    ])
      .then(([uvpaa, caps]) => setState(uvpaa || caps?.passkeyPlatformAuthenticator ? "available" : "unavailable"))
      .catch(() => setState("unavailable"));
  }, []);
  return state;
}

/** The way out of an embedded browser: the address, and a way to carry it over.
 *  Shown both when detection catches the WebView up front and when the ceremony
 *  is what caught it - by then the button has already failed once. */
function OpenInBrowser({ title }: { title: string }) {
  return (
    <div>
      <h2 className="serif mb-2 text-[18px]">{title}</h2>
      <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {t("onboarding.noWebauthnBody")}
      </p>
      <p
        className="mb-4 rounded-[6px] border px-3 py-2 text-[12px] break-all"
        style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
      >
        {window.location.href}
      </p>
      <Button variant="ghost" className="w-full" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
        {t("onboarding.copyLink")}
      </Button>
    </div>
  );
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
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  // A session with no credential is a half-finished enrolment: register/options
  // created the account and signed them in, and the ceremony then failed. The
  // name is already on the account, so the only thing still owed is the passkey.
  const enrolled = (me.data?.credentials.length ?? 0) > 0;
  const halfEnrolled = !!me.data && !enrolled;
  useEffect(() => {
    if (halfEnrolled) setStep((s) => (s === "name" ? "passkey" : s));
  }, [halfEnrolled]);

  // Registration signs you in, so `me.data` becomes truthy BEFORE the VPA step gets
  // to render. Without the step check that redirect fires first and the VPA prompt
  // is unreachable for every new account. The `enrolled` check is the other half:
  // a half-finished enrolment must not be bounced into an app it cannot get back
  // out of - there is no second way to add the passkey it is missing.
  if (me.data && enrolled && step !== "vpa") return <Navigate to="/" replace />;

  const fail = (e: unknown, ceremony: "register" | "signIn") => setFailure(classifyAuthError(e, ceremony));

  const registerPasskey = async () => {
    setBusy(true);
    setFailure(null);
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
      fail(e, "register");
      // The account may now exist even though the passkey does not - options
      // creates the user. Refetching is what puts the screen into the
      // half-enrolled state above instead of asking for a name it already has.
      await qc.invalidateQueries({ queryKey: qk.me });
    } finally {
      setBusy(false);
    }
  };

  /** Returning user. Credentials are discoverable (residentKey: "required"), so
   *  the authenticator picks the account - nothing is typed and no display name
   *  is involved. Without this the only path off this screen is enrolment. */
  const signIn = async () => {
    setBusy(true);
    setFailure(null);
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
      fail(e, "signIn");
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
      fail(e, "register");
    } finally {
      setBusy(false);
    }
  };

  const onName = (e: FormEvent) => {
    e.preventDefault();
    // `required` alone leaves the button looking live and doing nothing when the
    // native bubble is suppressed. Say it in the page.
    if (displayName.trim() === "") return setFailure(plainFailure("onboarding.nameRequired"));
    if (owner && secret.trim() === "") return setFailure(plainFailure("onboarding.secretRequired"));
    setFailure(null);
    setStep("passkey");
  };

  // Feature detection cannot see this: an iOS WebView reports a platform
  // authenticator and fails at the sheet. Warn before the tap, don't block it.
  const embedded = typeof navigator !== "undefined" && isEmbeddedIosBrowser(navigator.userAgent);

  return (
    <div className="paper-ground h-full overflow-auto">
      <div className="relative z-10 mx-auto w-full max-w-[420px] px-5 py-10">
        <h1 className="serif mb-1 text-[26px] tracking-[-0.01em]">{t("onboarding.title")}</h1>
        <p className="mb-7 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t(inviteToken ? "onboarding.invitedSubtitle" : "onboarding.subtitle")}
        </p>

        {failure && (
          <div role="alert" className="mb-4 rounded-[6px] border px-3 py-2" style={{ borderColor: "var(--clay)", background: "var(--clay-wash)", color: "var(--clay)" }}>
            <p className="text-[13px]">{t(failure.messageKey)}</p>
            {/* The owner is the support desk on a self-hosted instance. Without
                the error name a report is "it said something went wrong". */}
            {failure.detail && (
              <p className="mt-1 text-[11px] opacity-70">{t("onboarding.errorDetail", { code: failure.detail })}</p>
            )}
          </div>
        )}

        {embedded && authenticator !== "unavailable" && (
          <p role="status" className="mb-4 rounded-[6px] border px-3 py-2 text-[12px] leading-relaxed" style={{ borderColor: "var(--line)", background: "var(--paper-sunk)", color: "var(--ink-3)" }}>
            {t("onboarding.inAppWarning")}
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

        {step === "passkey" && authenticator === "unavailable" && <OpenInBrowser title={t("onboarding.noWebauthnTitle")} />}

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

        {/* Offered UNDER the action, never instead of it. The error that reaches
            here is the same one a plain cancel raises, so replacing the button
            with a copy-link panel would strand someone who simply tapped no. */}
        {failure?.escapeHatch && authenticator !== "unavailable" && (
          <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--line)" }}>
            <OpenInBrowser title={t("onboarding.noWebauthnTitle")} />
          </div>
        )}
      </div>
    </div>
  );
}

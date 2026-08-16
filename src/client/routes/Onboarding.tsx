import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "~/client/components/ui";
import { api } from "~/client/lib/api";
import { qk, useMe } from "~/client/lib/queries";
import { classifyAuthError, isEmbeddedIosBrowser, plainFailure, type AuthFailure } from "~/client/lib/passkey";
import { emailProblem, newPasswordProblem, passwordErrorKey, signInWithPassword, signUp } from "~/client/lib/authApi";
import { t } from "~/client/i18n";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

/** `getClientCapabilities` is newer than the DOM types here and absent on most
 *  of the browsers this matters for, so it is read defensively. */
type ClientCapabilities = { passkeyPlatformAuthenticator?: boolean };

/** Which screen. "name" is the passkey-enrolment name step - the owner claiming
 *  the instance, or someone who chose a passkey over a password. */
type View = "signin" | "signup" | "name" | "passkey" | "vpa";

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

/** The "or" rule between a primary path and its alternative. */
const Or = () => (
  <div className="my-4 flex items-center gap-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
    <span className="h-px flex-1" style={{ background: "var(--line)" }} />
    {t("onboarding.or")}
    <span className="h-px flex-1" style={{ background: "var(--line)" }} />
  </div>
);

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

  // An invite is the only thing that can create an account, so it is the only
  // thing that makes sign-UP the default. Everyone else is a returning user.
  const [view, setView] = useState<View>(recoveryToken ? "passkey" : inviteToken ? "signup" : "signin");
  const [owner, setOwner] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [vpa, setVpa] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  // A session with no passkey AND no password is a half-finished enrolment:
  // register/options created the account and signed them in, and the ceremony
  // then failed. A password account with no passkey is COMPLETE - the password
  // is a way back in, which is the whole point of it.
  const complete = !!me.data && (me.data.credentials.length > 0 || me.data.hasPassword);
  const halfEnrolled = !!me.data && !complete;
  useEffect(() => {
    if (halfEnrolled) setView((v) => (v === "passkey" || v === "vpa" ? v : "passkey"));
  }, [halfEnrolled]);

  // Registration signs you in, so `me.data` becomes truthy BEFORE the VPA step gets
  // to render. Without the step check that redirect fires first and the VPA prompt
  // is unreachable for every new account. The `complete` check is the other half:
  // a half-finished enrolment must not be bounced into an app it cannot get back
  // out of - there is no second way to add the credential it is missing.
  if (me.data && complete && view !== "vpa") return <Navigate to="/" replace />;

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
      setView("vpa");
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

  /** Returning user, passkey. Credentials are discoverable (residentKey:
   *  "required"), so the authenticator picks the account - nothing is typed and
   *  no display name is involved. */
  const signInPasskey = async () => {
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

  /** Returning user, password. Works in an in-app browser, which is exactly why
   *  it is the primary path and is never behind the authenticator check. */
  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    const problem = emailProblem(email) ?? (password === "" ? "onboarding.passwordRequired" : null);
    if (problem) return setFailure(plainFailure(problem));

    setBusy(true);
    setFailure(null);
    try {
      await signInWithPassword({ email, password });
      // Never kept around: the value that signed them in is gone the moment it has.
      setPassword("");
      // An existing account following an invite still needs the invite applied -
      // signup consumed nothing on this path.
      if (inviteToken) await api(`/api/invites/${inviteToken}/accept`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate("/", { replace: true });
    } catch (err) {
      // 401 says nothing about whether the address exists here - both halves of
      // "wrong email" and "wrong password" collapse into the one sentence.
      setFailure(plainFailure(passwordErrorKey(err, "onboarding.signInFailed")));
    } finally {
      setBusy(false);
    }
  };

  const onSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteToken) return setFailure(plainFailure("onboarding.inviteRequired"));
    const problem =
      (displayName.trim() === "" ? "onboarding.nameRequired" : null) ??
      emailProblem(email) ??
      newPasswordProblem(password);
    if (problem) return setFailure(plainFailure(problem));

    setBusy(true);
    setFailure(null);
    try {
      const created = await signUp({ inviteToken, displayName: displayName.trim(), email, password });
      setPassword("");
      // Signup already consumed the invite and set the session cookie, so there
      // is no accept call here. Navigate BEFORE invalidating `me`: the redirect
      // guard above sends every signed-in visitor to "/" and would swallow the
      // ledger the invite just joined them to.
      navigate(created.ledgerId ? `/ledgers/${created.ledgerId}` : "/", { replace: true });
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      setFailure(plainFailure(passwordErrorKey(err, "onboarding.signUpFailed")));
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
    setView("passkey");
  };

  const go = (next: View) => {
    setFailure(null);
    setView(next);
  };

  // Feature detection cannot see this: an iOS WebView reports a platform
  // authenticator and fails at the sheet. Warn before the tap, don't block it.
  const embedded = typeof navigator !== "undefined" && isEmbeddedIosBrowser(navigator.userAgent);
  // The warning and the escape hatch are about passkeys only. A password sign-in
  // works fine in an in-app browser, so neither may cover the password views.
  const passkeyView = view === "name" || view === "passkey";

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

        {embedded && passkeyView && authenticator !== "unavailable" && (
          <p role="status" className="mb-4 rounded-[6px] border px-3 py-2 text-[12px] leading-relaxed" style={{ borderColor: "var(--line)", background: "var(--paper-sunk)", color: "var(--ink-3)" }}>
            {t("onboarding.inAppWarning")}
          </p>
        )}

        {view === "signin" && (
          // noValidate: the handler reports problems in the page. Left to the
          // native bubble, a suppressed prompt makes the button look broken.
          <form onSubmit={onSignIn} noValidate>
            <Field label={t("onboarding.emailLabel")}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field label={t("onboarding.passwordLabel")}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {t("onboarding.signInWithPassword")}
            </Button>

            <Or />

            <Button variant="ghost" className="w-full" onClick={signInPasskey} disabled={busy}>
              {t("onboarding.signInPasskey")}
            </Button>

            <p className="mt-5 text-[11.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {t("onboarding.contactAdmin")}
            </p>

            {/* An invite is what makes an account possible, so the offer to make
                one only exists when there is a token to spend. */}
            {inviteToken && (
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => go("signup")}>
                {t("onboarding.needAccount")}
              </Button>
            )}
            {!inviteToken && !owner && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  setOwner(true);
                  go("name");
                }}
              >
                {t("onboarding.iRunThis")}
              </Button>
            )}
          </form>
        )}

        {view === "signup" && (
          <form onSubmit={onSignUp} noValidate>
            <h2 className="serif mb-2 text-[18px]">{t("onboarding.signUpTitle")}</h2>
            <p className="mb-4 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {t("onboarding.signUpBody")}
            </p>
            <Field label={t("profile.displayName")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} autoFocus />
            </Field>
            <Field label={t("onboarding.emailLabel")}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoComplete="email"
              />
            </Field>
            <Field label={t("onboarding.passwordNewLabel")}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {t("onboarding.createAccount")}
            </Button>

            <Or />

            {/* The name typed above carries over, so this is one tap, not a restart. */}
            <Button variant="ghost" className="w-full" onClick={() => go("name")} disabled={busy}>
              {t("onboarding.passkeyAlternative")}
            </Button>
            <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => go("signin")}>
              {t("onboarding.haveAccount")}
            </Button>
          </form>
        )}

        {view === "name" && (
          <form onSubmit={onName} noValidate>
            <Field label={t("profile.displayName")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} autoFocus />
            </Field>
            {owner && (
              <Field label={t("onboarding.bootstrapSecret")}>
                <Input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" />
              </Field>
            )}
            <Button type="submit" className="w-full">
              {t("action.continue")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              onClick={() => go(inviteToken ? "signup" : "signin")}
            >
              {t(inviteToken ? "onboarding.passwordAlternative" : "onboarding.haveAccount")}
            </Button>
          </form>
        )}

        {view === "passkey" && authenticator === "checking" && (
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("onboarding.checking")}
          </p>
        )}

        {view === "passkey" && authenticator === "unavailable" && <OpenInBrowser title={t("onboarding.noWebauthnTitle")} />}

        {view === "passkey" && authenticator === "available" && (
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

        {view === "vpa" && (
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
        {failure?.escapeHatch && passkeyView && authenticator !== "unavailable" && (
          <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--line)" }}>
            <OpenInBrowser title={t("onboarding.noWebauthnTitle")} />
          </div>
        )}
      </div>
    </div>
  );
}

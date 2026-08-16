// Set or change the account password, in the You tab. YouTab prints the heading.
//
// Two forms, one endpoint. Which one you get is decided by `hasPassword` from
// the server, never by whether an email happens to be filled in - the server
// makes the same decision and would reject the mismatch anyway.
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "~/client/components/ui";
import { qk, useMe } from "~/client/lib/queries";
import { emailProblem, newPasswordProblem, passwordErrorKey, setPassword } from "~/client/lib/authApi";
import { t } from "~/client/i18n";

export function PasswordSection() {
  const me = useMe();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!me.data) return null;
  const { hasPassword } = me.data;
  // Set once. The address is the sign-in identifier and a unique key, so once it
  // exists it is read-only here - changing it is not a profile edit.
  const existingEmail = me.data.email;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const problem =
      (hasPassword && current === "" ? "onboarding.passwordRequired" : null) ??
      (existingEmail === null ? emailProblem(email) : null) ??
      newPasswordProblem(next);
    if (problem) return setError(problem);

    setBusy(true);
    setError(null);
    try {
      await setPassword({
        // Always the account's address, never the typed one when it already has
        // one - it is the KDF salt, and the wrong salt is an unusable password.
        email: existingEmail ?? email,
        ...(hasPassword ? { currentPassword: current } : {}),
        password: next,
      });
      // Cleared on the way out - neither value is kept once it has been sent.
      setCurrent("");
      setNext("");
      setSaved(true);
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      setError(passwordErrorKey(err, "profile.passwordFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-[7px] border px-3.5 py-3.5"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {hasPassword ? t("profile.passwordChange") : t("profile.passwordSet")}
      </p>

      {existingEmail === null ? (
        <Field label={t("profile.email")}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="email"
            placeholder={t("profile.emailNone")}
          />
        </Field>
      ) : (
        <Field label={t("profile.email")}>
          <Input value={existingEmail} readOnly disabled />
        </Field>
      )}

      {hasPassword && (
        <Field label={t("profile.passwordCurrent")}>
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
      )}

      <Field label={t("profile.passwordNew")}>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>

      <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {/* The "set once" warning only earns its place while it is still true. */}
        {existingEmail === null && `${t("profile.emailHint")} `}
        {t("profile.passwordHint")}
      </p>

      <Button type="submit" size="sm" disabled={busy}>
        {t("action.save")}
      </Button>

      {error && (
        <p role="alert" className="mt-2.5 text-[11.5px]" style={{ color: "var(--clay)" }}>
          {t(error)}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-2.5 text-[11.5px]" style={{ color: "var(--moss-2)" }}>
          {t("profile.passwordSaved")}
        </p>
      )}
    </form>
  );
}

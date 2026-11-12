// SPEC §10: "Updates prompt; never auto-reload - it would destroy a half-filled
// expense form. The API must tolerate one version of skew, because people
// dismiss prompts."
//
// So: no `autoUpdate`, no reload on our own initiative, and dismissing is a real
// choice that sticks for the session.
import { useRegisterSW } from "virtual:pwa-register/react";
import { t } from "~/client/i18n";
import { Button } from "./ui/Button";

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // A live region: a change of app version is exactly the sort of thing a
  // screen-reader user is otherwise never told about (SPEC §10, accessibility).
  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print flex items-center gap-3 px-4 py-2 text-[14px]"
      style={{ background: "var(--moss-wash)", color: "var(--moss)" }}
    >
      <span className="flex-1">
        <strong className="font-medium">{t("pwa.updateTitle")}</strong> {t("pwa.updateBody")}
      </span>
      <Button size="sm" onClick={() => updateServiceWorker(true)}>
        {t("pwa.updateAction")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setNeedRefresh(false)}>
        {t("pwa.dismiss")}
      </Button>
    </div>
  );
}

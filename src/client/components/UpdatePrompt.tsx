// SPEC §10: "Updates prompt; never auto-reload — it would destroy a half-filled
// expense form. The API must tolerate one version of skew, because people
// dismiss prompts."
//
// So: no `autoUpdate`, no reload on our own initiative, and dismissing is a real
// choice that sticks for the session.
import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);

  // A live region: a change of app version is exactly the sort of thing a
  // screen-reader user is otherwise never told about (SPEC §10, accessibility).
  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 text-[12px]"
      style={{ background: "var(--moss-wash)", color: "var(--moss)" }}
    >
      <span className="flex-1">
        <strong className="font-medium">{t("pwa.updateTitle")}</strong> {t("pwa.updateBody")}
      </span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className={`min-h-11 px-2 font-medium underline ${focusRing}`}
      >
        {t("pwa.updateAction")}
      </button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          setNeedRefresh(false);
        }}
        className={`min-h-11 px-2 ${focusRing}`}
      >
        {t("pwa.dismiss")}
      </button>
    </div>
  );
}

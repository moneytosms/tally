// SPEC §10: "Install offered AFTER the first successful action, never on load."
//
// So two things have to be true before the bar appears: the browser fired
// `beforeinstallprompt` (so there is something to install into), and the user
// has completed a write. iOS never fires that event - its install is manual, and
// its instructions live on the You tab beside notifications, per the spec.
import { useEffect, useState } from "react";
import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

type InstallEvent = Event & { prompt: () => Promise<void> };

const ACTED = "tally.acted";
const DISMISSED = "tally.install-dismissed";

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Guarded: this module is imported by tests that run without a DOM.
globalThis.addEventListener?.("beforeinstallprompt", (e) => {
  // Keeping the event is the whole point: Chrome only hands it over once, and
  // showing our own bar means we must not let the browser's default mini-bar run.
  e.preventDefault();
  deferred = e as InstallEvent;
  notify();
});

/** Call after a write succeeds. Persisted, so the offer survives a reload -
 *  "has this person ever done anything" is not a per-session question. */
export function markActed() {
  try {
    localStorage.setItem(ACTED, "1");
  } catch {
    // Private mode with storage denied: no install offer, nothing else breaks.
  }
  notify();
}

const flag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export function InstallPrompt() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);

  if (deferred === null || !flag(ACTED) || flag(DISMISSED)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 text-[12px]"
      style={{ background: "var(--moss-wash)", color: "var(--moss)" }}
    >
      <span className="flex-1">
        <strong className="font-medium">{t("pwa.installTitle")}</strong> {t("pwa.installBody")}
      </span>
      <button
        type="button"
        onClick={() => {
          void deferred?.prompt();
          // Either way the event is spent - Chrome will not replay it.
          deferred = null;
          notify();
        }}
        className={`min-h-11 px-2 font-medium underline ${focusRing}`}
      >
        {t("pwa.installAction")}
      </button>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED, "1");
          } catch {
            deferred = null;
          }
          notify();
        }}
        className={`min-h-11 px-2 ${focusRing}`}
      >
        {t("pwa.dismiss")}
      </button>
    </div>
  );
}

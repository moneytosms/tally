import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";
import { Icon } from "./ui/Icon";

/** The one shadow in the whole design system. Shown only where fabVisible() says so.
 *  `starting:` is the entrance (CSS @starting-style); the global reduced-motion rule kills it. */
export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("expense.add")}
      className={`no-print offset-safe-bottom absolute right-4 z-30 grid h-[49px] w-[49px] place-items-center rounded-[13px] select-none transition-[scale,opacity] duration-150 ease-out starting:scale-90 starting:opacity-0 active:scale-[0.98] md:hidden ${focusRing}`}
      style={{ background: "var(--moss)", color: "var(--paper)", boxShadow: "0 4px 14px rgb(60 72 54 / 28%)" }}
    >
      <Icon name="plus" size={24} />
    </button>
  );
}

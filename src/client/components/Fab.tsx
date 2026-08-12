import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

/** The one shadow in the whole design system. */
export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("expense.add")}
      className={`offset-safe-bottom absolute right-4 z-30 grid h-[49px] w-[49px] place-items-center rounded-[13px] text-[25px] font-light ${focusRing}`}
      style={{ background: "var(--moss)", color: "var(--paper)", boxShadow: "0 4px 14px rgb(60 72 54 / 28%)" }}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

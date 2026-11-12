import type { ReactNode } from "react";
import { Button, Sheet } from "~/client/components/ui";
import { t } from "~/client/i18n";

/** The one "Filter and sort" sheet. Fields apply live; the footer clears everything or closes. */
export function FilterSheet({
  open,
  onOpenChange,
  title,
  showLabel,
  onClear,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Already localised, e.g. "Show 3 expenses". */
  showLabel: string;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {children}
      <div className="mt-2 flex gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <Button variant="ghost" className="flex-1" onClick={onClear}>
          {t("filter.clearAll")}
        </Button>
        <Button className="flex-1" onClick={() => onOpenChange(false)}>
          {showLabel}
        </Button>
      </div>
    </Sheet>
  );
}

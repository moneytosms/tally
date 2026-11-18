import { useState } from "react";
import { Amount, Icon, Sheet, focusRing } from "~/client/components/ui";
import type { CategorySpend } from "~/client/lib/queries";
import { formatDate } from "~/client/lib/format";
import { t } from "~/client/i18n";

/** Category totals on an insights screen. Tapping one opens the expenses behind it. */
export function CategoryList({ categories, itemLabel }: { categories: CategorySpend[]; itemLabel: string }) {
  // Keyed by id, not held as an object, so a refetch shows fresh items. "" is Uncategorised.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = categories.find((c) => (c.categoryId ?? "") === openKey);

  return (
    <>
      <ul className="mt-2">
        {categories.map((c) => (
          <li key={c.categoryId ?? "none"}>
            <button
              type="button"
              onClick={() => setOpenKey(c.categoryId ?? "")}
              aria-label={t("insights.showCategory", { name: c.name })}
              className={`-mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between gap-2.5 rounded-[7px] px-1.5 py-1 text-left ${focusRing}`}
            >
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {c.icon && <span aria-hidden="true">{c.icon} </span>}
                {c.name}
              </span>
              <Amount paise={c.spent} label={t("insights.expenseCount", { count: c.count })} tone="neutral" />
              <Icon name="chevronRight" size={16} className="flex-none" />
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={open !== undefined}
        onOpenChange={(next) => !next && setOpenKey(null)}
        title={open ? `${open.icon ? `${open.icon} ` : ""}${open.name}` : ""}
      >
        {open && (
          <>
            <div className="mb-3">
              <Amount paise={open.spent} label={t("insights.expenseCount", { count: open.count })} tone="neutral" />
            </div>
            <ul>
              {open.items.map((i) => (
                <li
                  key={i.expenseId}
                  className="flex items-center justify-between gap-2.5 border-t py-2.5"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px]">{i.description}</div>
                    <div className="truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
                      {i.ledgerName
                        ? t("insights.itemMeta", { date: formatDate(i.paidAt), ledger: i.ledgerName })
                        : formatDate(i.paidAt)}
                    </div>
                  </div>
                  <Amount paise={i.amount} label={itemLabel} tone="neutral" />
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </>
  );
}

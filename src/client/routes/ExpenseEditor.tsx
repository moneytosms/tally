// Edit one expense, full screen. Any member may edit or delete any expense
// (ADR 0005) - the revision trail the server writes is the control, not a
// permission check here.
//
// The form itself is ExpenseForm in edit mode: same fields, same split editor,
// same resolution rules. This screen only loads the expense and owns delete.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { Button, EmptyState, ScreenSkeleton, focusRing } from "~/client/components/ui";
import ExpenseForm, { type EditableExpense } from "~/client/routes/ExpenseForm";
import { api } from "~/client/lib/api";
import { qk, useDeleteExpense } from "~/client/lib/queries";
import { t } from "~/client/i18n";

export default function ExpenseEditor() {
  const { ledgerId = "", expenseId = "" } = useParams();
  const navigate = useNavigate();
  const back = () => navigate(`/ledgers/${ledgerId}`);

  // There is no GET for a single expense; the list is the read path, and sharing
  // its query key means every expense mutation already invalidates this.
  const expenses = useQuery({
    queryKey: qk.expenses(ledgerId),
    queryFn: () => api<EditableExpense[]>(`/api/ledgers/${ledgerId}/expenses`),
  });

  const remove = useDeleteExpense(ledgerId);
  const [confirming, setConfirming] = useState(false);

  if (expenses.isPending) return <ScreenSkeleton />;
  if (expenses.error) return <EmptyState title={t("error.generic")} body={t("error.network")} />;

  const expense = expenses.data.find((e) => e.id === expenseId);
  if (!expense) return <EmptyState title={t("error.generic")} body={t("expense.deleted")} />;

  return (
    <>
      <header className="mb-3 flex items-end gap-2.5 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link
          to={`/ledgers/${ledgerId}`}
          aria-label={t("action.back")}
          className={`grid min-h-11 min-w-11 place-items-center text-[17px] ${focusRing}`}
          style={{ color: "var(--ink-3)" }}
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="serif truncate text-[21px] tracking-[-0.01em]">{t("expense.edit")}</h1>
          <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
            {expense.description}
          </div>
        </div>
      </header>

      <ExpenseForm expense={expense} onDone={back} />

      {/* Two steps, in the page. A browser modal is never used here: it can't be
          styled, can't be translated, and is suppressible by the browser. */}
      <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        {confirming ? (
          <>
            <p className="mb-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
              {t("expense.deleteConfirm")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(expense.id, { onSuccess: back })}
              >
                {t("action.confirm")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t("action.cancel")}
              </Button>
            </div>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("action.delete")}
          </Button>
        )}
        <p role="alert" aria-live="assertive" className="mt-1.5 text-[12px]" style={{ color: "var(--clay)" }}>
          {remove.isError ? t("expense.deleteFailed") : ""}
        </p>
      </div>
    </>
  );
}

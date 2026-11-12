// Edit one expense, full screen. Any member may edit or delete any expense
// (ADR 0005) - the revision trail the server writes is the control, not a
// permission check here.
//
// The form itself is ExpenseForm in edit mode: same fields, same split editor,
// same resolution rules. This screen only loads the expense and owns delete.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { Button, ConfirmDialog, EmptyState, PageHeader, ScreenSkeleton } from "~/client/components/ui";
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

  // The optimistic delete takes the row out of the list while the DELETE is in
  // flight. Keep the last copy so the form stays mounted and unsaved edits survive
  // a failed delete.
  const found = expenses.data?.find((e) => e.id === expenseId);
  const [kept, setKept] = useState<EditableExpense>();
  if (found && found !== kept) setKept(found);
  const expense = found ?? (remove.isPending ? kept : undefined);

  // Every state below gets the header, so a failed load is never a dead end.
  const header = <PageHeader title={t("expense.edit")} back={`/ledgers/${ledgerId}`} />;

  let body;
  if (expenses.isPending) {
    body = (
      <>
        {header}
        <ScreenSkeleton />
      </>
    );
  } else if (expenses.error && !expenses.data) {
    body = (
      <>
        {header}
        <EmptyState
          title={t("error.generic")}
          body={t("error.network")}
          action={
            <Button variant="ghost" onClick={() => expenses.refetch()}>
              {t("action.retry")}
            </Button>
          }
        />
      </>
    );
  } else if (!expense) {
    body = (
      <>
        {header}
        <EmptyState
          title={t("expense.goneTitle")}
          body={t("expense.goneBody")}
          action={
            <Button variant="ghost" onClick={back}>
              {t("action.back")}
            </Button>
          }
        />
      </>
    );
  } else {
    body = (
      <>
        {header}

        <ExpenseForm expense={expense} onDone={back} />

        <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--line)" }}>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("confirm.deleteExpense.action")}
          </Button>
          <p role="alert" aria-live="assertive" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
            {remove.isError ? t("expense.deleteFailed") : ""}
          </p>
        </div>
      </>
    );
  }

  // The form's sticky footer does not pad the safe area (a Sheet already does), so the page does.
  return (
    <>
      <div className="pad-safe-bottom">{body}</div>

      {confirming && (
        <ConfirmDialog
          title={t("confirm.deleteExpense.title")}
          body={t("expense.deleteConfirm")}
          confirmLabel={t("confirm.deleteExpense.action")}
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate(expenseId, { onSuccess: back, onSettled: () => setConfirming(false) })}
        />
      )}
    </>
  );
}

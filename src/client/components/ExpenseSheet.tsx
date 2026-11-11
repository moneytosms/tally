// Expense detail sheet: read-only detail + comments + edit history/restore + delete.
// Opened by tapping an expense row in LedgerDetail.
import { useState } from "react";
import { Link } from "react-router";
import {
  Amount,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Sheet,
  Skeleton,
  focusRing,
} from "~/client/components/ui";
import {
  useAddComment,
  useCategories,
  useComments,
  useDeleteComment,
  useDeleteExpense,
  useMe,
  useRestoreRevision,
  useRevisions,
  type Expense,
  type Member,
  type Revision,
} from "~/client/lib/queries";
import { t } from "~/client/i18n";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const nameOf = (members: Member[], id: string) => members.find((m) => m.id === id)?.nickname ?? t("member.unknown");

/** What restoring a revision would actually change. A revision row is a whole
 *  prior expense, and "Edited by Asha" alone never said whether pressing restore
 *  moves money - this does. */
export type RevisionChange = "total" | "payer" | "splits";

/** Amount-per-member, order-independent: stable order matters to rounding, not to
 *  whether two splits are the same money. */
const splitKey = (splits: Expense["splits"]) =>
  splits
    .map((s) => `${s.memberId}:${s.amount}`)
    .sort()
    .join("|");

export function revisionDiff(
  snapshot: Pick<Expense, "total" | "payerMemberId" | "splits">,
  current: Pick<Expense, "total" | "payerMemberId" | "splits">,
): RevisionChange[] {
  const changes: RevisionChange[] = [];
  if (snapshot.total !== current.total) changes.push("total");
  if (snapshot.payerMemberId !== current.payerMemberId) changes.push("payer");
  if (splitKey(snapshot.splits) !== splitKey(current.splits)) changes.push("splits");
  return changes;
}

const sectionLabel = { color: "var(--ink-2)" } as const;

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
      style={{ borderColor: "var(--line)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
        {label}
      </span>
      <span className="text-[15px]">{children}</span>
    </div>
  );
}

export type ExpenseSheetProps = {
  ledgerId: string;
  expense: Expense;
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExpenseSheet({ ledgerId, expense, members, open, onOpenChange }: ExpenseSheetProps) {
  const categories = useCategories();
  const me = useMe();

  const comments = useComments(ledgerId, expense.id);
  const addComment = useAddComment(ledgerId, expense.id);
  const deleteComment = useDeleteComment(ledgerId, expense.id);
  const [commentText, setCommentText] = useState("");
  const [confirmingCommentId, setConfirmingCommentId] = useState<string | null>(null);

  const revisions = useRevisions(ledgerId, expense.id);
  const restoreRevision = useRestoreRevision(ledgerId, expense.id);
  const [confirmingRestore, setConfirmingRestore] = useState<Revision | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);

  const deleteExpense = useDeleteExpense(ledgerId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A negative total is a Refund and must not read as an expense.
  const isRefund = expense.total < 0;
  const category = categories.data?.find((c) => c.id === expense.categoryId);

  const postComment = () => {
    const body = commentText.trim();
    // Enter and the Post button both land here; a second submit while one is in flight would double-post.
    if (!body || addComment.isPending) return;
    addComment.mutate(body, { onSuccess: () => setCommentText("") });
  };

  const handleRestore = (revisionId: string) => {
    setRestoreStatus(null);
    restoreRevision.mutate(revisionId, {
      onSuccess: () => setRestoreStatus(t("expense.restored")),
      onError: () => setRestoreStatus(t("expense.restoreFailed")),
    });
  };

  // The dialog stays up, showing its busy state, until the delete settles.
  const handleDelete = () =>
    deleteExpense.mutate(expense.id, {
      onSuccess: () => onOpenChange(false),
      onSettled: () => setConfirmingDelete(false),
    });

  const sortedComments = [...(comments.data ?? [])].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={expense.description}>
      {/* ---------- detail ---------- */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Amount paise={expense.total} label={t("expense.total")} tone="neutral" hero />
        {isRefund && (
          <span
            className="rounded-[5px] border px-1.5 py-0.5 text-[13px] font-medium"
            style={{ borderColor: "var(--moss)", background: "var(--moss-wash)", color: "var(--moss-2)" }}
          >
            {t("expense.refund")}
          </span>
        )}
      </div>

      <div
        className="mb-4 rounded-[7px] border px-3.5"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
        <DetailRow label={t("expense.paidBy")}>{nameOf(members, expense.payerMemberId)}</DetailRow>
        <DetailRow label={t("expense.date")}>{dateFmt.format(expense.paidAt)}</DetailRow>
        <DetailRow label={t("expense.category")}>{category?.name ?? t("expense.categoryNone")}</DetailRow>
        {expense.notes && <DetailRow label={t("expense.notes")}>{expense.notes}</DetailRow>}
      </div>

      <div className="mx-0.5 mb-2 text-[13px] font-semibold" style={sectionLabel}>
        {t("expense.participants")}
      </div>
      <div
        className="mb-5 rounded-[7px] border px-3.5"
        style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
      >
        {expense.splits.map((s) => (
          <div
            key={s.memberId}
            className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
            style={{ borderColor: "var(--line)" }}
          >
            <span className="text-[15px]">{nameOf(members, s.memberId)}</span>
            <Amount paise={s.amount} label={t("expense.shareLabel")} tone="neutral" />
          </div>
        ))}
      </div>

      {/* ---------- comments ---------- */}
      <div className="mx-0.5 mb-2 text-[13px] font-semibold" style={sectionLabel}>
        {t("expense.comments")}
      </div>
      {comments.isPending ? (
        <div className="mb-3">
          <Skeleton className="mb-2 h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : comments.error ? (
        <EmptyState title={t("error.generic")} body={t("error.network")} />
      ) : sortedComments.length === 0 ? (
        <p className="mb-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("expense.commentEmpty")}
        </p>
      ) : (
        <ul className="mb-3">
          {sortedComments.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-2 border-b py-2 last:border-b-0"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                  {c.authorName} · {timeFmt.format(c.createdAt)}
                </div>
                <div className="text-[15px] break-words">{c.body}</div>
              </div>
              {c.authorUserId === me.data?.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingCommentId(c.id)}
                  aria-label={t("expense.commentDelete")}
                  className="flex-none"
                >
                  {t("action.delete")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Field label={t("expense.commentPlaceholder")}>
          <Input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && postComment()}
          />
        </Field>
        <Button
          variant="ghost"
          size="sm"
          onClick={postComment}
          disabled={!commentText.trim()}
          isLoading={addComment.isPending}
          className="mt-1"
        >
          {t("expense.commentSend")}
        </Button>
      </div>
      <p role="alert" aria-live="assertive" className="mt-1.5 mb-6 text-[13px]" style={{ color: "var(--clay)" }}>
        {addComment.isError || deleteComment.isError ? t("error.generic") : ""}
      </p>

      {/* ---------- history + restore ---------- */}
      <details className="mb-6">
        <summary
          className={`inline-flex min-h-11 cursor-pointer list-none items-center rounded-[7px] border px-3 text-[14px] font-medium ${focusRing}`}
          style={{ borderColor: "var(--line-2)", color: "var(--ink)" }}
        >
          {t("expense.history")}
        </summary>
        {revisions.isPending ? (
          <div className="py-2">
            <Skeleton className="mb-2 h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : revisions.error ? (
          <p className="py-2 text-[13px]" style={{ color: "var(--clay)" }}>
            {t("error.generic")}
          </p>
        ) : (revisions.data ?? []).length === 0 ? (
          <p className="py-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {t("expense.historyNone")}
          </p>
        ) : (
          <>
            {/* The newest revision IS what undo used to restore, so a per-row
                restore makes a separate "undo last edit" button a second name for
                the first row's button. One affordance, no ambiguity. */}
            <p className="mt-1 mb-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
              {t("expense.historyHint")}
            </p>
            <ul className="mb-2">
              {(revisions.data ?? []).map((r) => {
                const changes = revisionDiff(r.snapshot, expense);
                return (
                  <li key={r.id} className="border-b py-2 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                    <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                      {t("expense.editedBy", { name: r.revisedByName })} · {timeFmt.format(r.revisedAt)}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-[15px]">{r.snapshot.description}</span>
                      <Amount paise={r.snapshot.total} label={t("expense.historyTotal")} tone="neutral" />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                        {changes.length === 0
                          ? t("expense.diffNone")
                          : changes
                              .map((c) =>
                                c === "payer"
                                  ? t("expense.diff.payer", { name: nameOf(members, r.snapshot.payerMemberId) })
                                  : t(`expense.diff.${c}`),
                              )
                              .join(" · ")}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-none"
                        disabled={restoreRevision.isPending}
                        onClick={() => setConfirmingRestore(r)}
                      >
                        {t("expense.restore")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p role="status" aria-live="polite" className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
              {restoreStatus}
            </p>
          </>
        )}
      </details>

      {confirmingRestore && (
        <ConfirmDialog
          title={t("confirm.restoreRevision.title")}
          body={t("confirm.restoreRevision.body")}
          confirmLabel={t("confirm.restoreRevision.action")}
          danger={false}
          onCancel={() => setConfirmingRestore(null)}
          onConfirm={() => {
            const revisionId = confirmingRestore.id;
            setConfirmingRestore(null);
            handleRestore(revisionId);
          }}
        />
      )}

      {confirmingCommentId && (
        <ConfirmDialog
          title={t("confirm.deleteComment.title")}
          confirmLabel={t("confirm.deleteComment.action")}
          onCancel={() => setConfirmingCommentId(null)}
          onConfirm={() => {
            const commentId = confirmingCommentId;
            setConfirmingCommentId(null);
            deleteComment.mutate(commentId);
          }}
        />
      )}

      {/* ---------- edit ---------- */}
      {/* The only way into the editor: the row itself opens this sheet, and a
          link cannot live inside that row's <button>. */}
      <Link
        to={`/ledgers/${ledgerId}/expenses/${expense.id}`}
        className={`mb-3 inline-flex min-h-11 items-center justify-center rounded-[7px] border px-4 text-[15px] font-semibold ${focusRing}`}
        style={{ background: "var(--moss)", color: "var(--paper)", borderColor: "var(--moss)" }}
      >
        {t("expense.edit")}
      </Link>

      {/* ---------- delete ---------- */}
      <Button variant="danger" onClick={() => setConfirmingDelete(true)} isLoading={deleteExpense.isPending}>
        {t("action.delete")}
      </Button>
      <p role="status" aria-live="polite" className="mt-1.5 text-[13px]" style={{ color: "var(--clay)" }}>
        {deleteExpense.isError ? t("error.generic") : ""}
      </p>

      {confirmingDelete && (
        <ConfirmDialog
          title={t("confirm.deleteExpense.title")}
          body={t("expense.deleteConfirm")}
          confirmLabel={t("confirm.deleteExpense.action")}
          busy={deleteExpense.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </Sheet>
  );
}

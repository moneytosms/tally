// Comments on expenses. Unlike expenses (any member may edit, ADR 0005), a
// comment is speech, not shared ledger state - only its author may delete it.
//
// Mounted at `/api` by the root app; paths below are relative to that.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { rejectArchivedWrites } from "~/server/routes/expenses";
import { uuidv7 } from "~/shared/id";
import { createCommentSchema } from "~/shared/schemas";

const LIST = "/ledgers/:ledgerId/expenses/:expenseId/comments";
const ITEM = "/ledgers/:ledgerId/comments/:commentId";

const comments = new Hono<Env>();
comments.use(LIST, requireSession, requireMember, rejectArchivedWrites);
comments.use(ITEM, requireSession, requireMember, rejectArchivedWrites);

comments.get(LIST, async (c) => {
  const rows = await c.var.db.listComments(c.req.param("expenseId"));
  return c.json(
    rows.map(({ comment, author }) => ({
      id: comment.id,
      body: comment.body,
      authorUserId: comment.authorUserId,
      authorName: author.displayName,
      createdAt: comment.createdAt,
    })),
  );
});

comments.post(LIST, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");
  const expenseId = c.req.param("expenseId");

  // Cross-ledger write guard: an expenseId from another ledger must 404, not
  // attach a comment to a ledger the caller only borrowed the id from.
  const expense = await db.findExpense(ledgerId, expenseId);
  if (!expense) return c.json({ error: "not found" }, 404);

  const parsed = createCommentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid comment", detail: parsed.error.issues }, 400);

  const now = Date.now();
  const row = {
    id: uuidv7(),
    ledgerId,
    expenseId,
    authorUserId: c.var.user.id,
    body: parsed.data.body,
    createdAt: now,
    deletedAt: null,
  };
  await db.insertComment(row);
  return c.json(
    {
      id: row.id,
      body: row.body,
      authorUserId: row.authorUserId,
      authorName: c.var.user.displayName,
      createdAt: row.createdAt,
    },
    201,
  );
});

comments.delete(ITEM, async (c) => {
  const db = c.var.db;
  const commentId = c.req.param("commentId");
  const comment = await db.findComment(commentId);
  if (!comment || comment.ledgerId !== c.req.param("ledgerId")) return c.json({ error: "not found" }, 404);
  if (comment.authorUserId !== c.var.user.id) return c.json({ error: "forbidden" }, 403);

  const now = Date.now();
  await db.softDeleteComment(commentId, now);
  return c.json({ id: commentId, deletedAt: now });
});

export default comments;

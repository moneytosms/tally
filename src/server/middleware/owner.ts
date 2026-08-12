import type { MiddlewareHandler } from "hono";
import type { Env, SessionUser } from "~/server/context";

/** Admin routes: the instance owner only. Requires requireSession first. */
export const requireOwner: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.var.user.isOwner) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** Ledger deletion is creator-only - the other exception to the membership rule.
 *  Lives here so the route can't quietly forget it. */
export function isLedgerCreator(
  ledger: { createdBy: string },
  user: SessionUser,
): boolean {
  return ledger.createdBy === user.id;
}

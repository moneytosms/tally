// The single authorisation rule: is the caller a current member of this ledger?
//
// Routes MUST carry the ledger id as a path parameter so no handler can forget this.
// Exactly two exceptions exist: ledger deletion (creator only) and admin routes (owner only).
import type { MiddlewareHandler } from "hono";
import type { Env, LedgerMember } from "~/server/context";

export const requireMember: MiddlewareHandler<Env> = async (c, next) => {
  const ledgerId = c.req.param("ledgerId");
  const member =
    ledgerId && (await c.var.db.findMember(ledgerId, c.var.user.id));
  if (!member) return c.json({ error: "forbidden" }, 403);
  c.set("member", member);
  await next();
};

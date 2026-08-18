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

/**
 * ADR 0008: a restricted account (one created from a ledger invite) is scoped
 * to the ledgers it already belongs to. It may not create a ledger or mint an
 * invite - both would hand it reach beyond what it was invited into. Routes
 * scoped to a ledger the caller is already a member of go through
 * `requireMember` instead and are unaffected.
 */
export const requireFull: MiddlewareHandler<Env> = async (c, next) => {
  if (c.var.user.accountType !== "full") return c.json({ error: "forbidden", code: "restricted" }, 403);
  await next();
};

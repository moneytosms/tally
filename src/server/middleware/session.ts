import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { Env } from "~/server/context";
import { SESSION_COOKIE, resolveSession } from "~/server/auth/session";

/** Resolves the session cookie to a user. 401 otherwise. */
export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token && (await resolveSession(c.var.db, token, Date.now()));
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  c.set("user", user);
  await next();
};

// The Worker. Serves /api/* and /.well-known/webauthn; static assets come from
// the Worker's asset binding, not from here.
//
// Response shapes stay additive: an older client must keep working after a
// deploy (SPEC §10 - people dismiss the update prompt). No version machinery,
// just never remove or repurpose a field.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { createDb } from "~/db";
import { ORIGIN, RP_ID } from "~/shared/rp-id";
import auth from "~/server/routes/auth";
import me from "~/server/routes/me";
import ledgers from "~/server/routes/ledgers";
import expenses from "~/server/routes/expenses";
import settlements from "~/server/routes/settlements";
import balances from "~/server/routes/balances";
import categories from "~/server/routes/categories";
import comments from "~/server/routes/comments";
import insights from "~/server/routes/insights";
import exportCsv from "~/server/routes/export";
import recurring from "~/server/routes/recurring";
import push from "~/server/routes/push";
import admin from "~/server/routes/admin";
import activity from "~/server/routes/activity";

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "same-origin");
  // Money data: never store an API response anywhere. A stale balance is worse
  // than no balance, and the service worker must not cache these either.
  if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
});

/**
 * Shipped from the FIRST deploy, deliberately. RP_ID is frozen at
 * tally.<account>.workers.dev; this document is what lets a custom domain be
 * added later WITHOUT re-enrolling every passkey. See docs/adr/0002, SPEC §3.
 */
app.get("/.well-known/webauthn", (c) =>
  c.json({ origins: [ORIGIN, `https://${RP_ID}`].filter((v, i, a) => a.indexOf(v) === i) }),
);

app.route("/api/auth", auth);
app.route("/api", me);
app.route("/api", ledgers);
app.route("/api", expenses);
app.route("/api", settlements);
app.route("/api", balances);
app.route("/api", categories);
app.route("/api", comments);
app.route("/api", insights);
app.route("/api", exportCsv);
app.route("/api", recurring);
app.route("/api", push);
app.route("/api", admin);
app.route("/api", activity);

app.notFound((c) => c.json({ error: "not found" }, 404));
// Never leak an internal message to the client, and never log a request body -
// tokens, secrets and challenges travel in them.
app.onError((_err, c) => c.json({ error: "internal error" }, 500));

export default app;
// The recurring-expense alarm. Exported here because a Durable Object class must
// be a named export of the Worker's entrypoint for wrangler to bind it.
export { RecurringAlarm } from "~/server/recurring-do";

// Push subscriptions and the two triggers that use them.
//
// SPEC §9: push has EXACTLY two triggers, both single-recipient -
//   1. someone settled with you   (fired from settlements.ts via notifySettled)
//   2. a manual settle reminder   (POST /push/nudge, rate-limited server-side)
//
// Deliberately no notification on split inclusion. That was the only
// high-fan-out path, and dropping it means tally never fans out to more than one
// recipient, which is what keeps the 10 ms CPU ceiling off the risk list. If you
// are about to add a third trigger, check it is still single-recipient.
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireSession } from "~/server/middleware/session";
import { sendPush, type PushMessage } from "~/server/push";
import { uuidv7 } from "~/shared/id";
import { nudgeSchema, pushSubscribeSchema } from "~/shared/schemas";
import { ORIGIN } from "~/shared/rp-id";
import type { Db } from "~/db";

/** One nudge per pair per 12 hours. Server-side, because a client-side limit is
 *  a suggestion. */
export const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const push = new Hono<Env>();
push.use("/push/*", requireSession);

/** The browser needs this to subscribe. Absent binding => push is simply off. */
push.get("/push/key", (c) =>
  c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? null }),
);

push.post("/push/subscribe", async (c) => {
  const parsed = pushSubscribeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid subscription", detail: parsed.error.issues }, 400);

  await c.var.db.insertPushSubscription({
    id: uuidv7(),
    userId: c.var.user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.p256dh,
    auth: parsed.data.auth,
    createdAt: Date.now(),
    failedAt: null,
  });
  return c.json({ ok: true }, 201);
});

push.post("/push/unsubscribe", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return c.json({ error: "endpoint required" }, 400);
  // Scoped to the caller: an endpoint is a bearer capability, and one user must
  // not be able to unsubscribe another's device by guessing it.
  await c.var.db.deletePushSubscription(body.endpoint, c.var.user.id);
  return c.json({ ok: true });
});

push.post("/push/nudge", async (c) => {
  const db = c.var.db;
  const parsed = nudgeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid nudge", detail: parsed.error.issues }, 400);
  const body = parsed.data;
  if (body.toUserId === c.var.user.id) return c.json({ error: "you cannot nudge yourself" }, 400);

  // Both parties must be current members of the ledger being nudged about -
  // otherwise this is an unsolicited-message endpoint with a ledger id attached.
  const me = await db.findMember(body.ledgerId, c.var.user.id);
  const them = await db.findMember(body.ledgerId, body.toUserId);
  if (!me || !them) return c.json({ error: "not found" }, 404);

  const now = Date.now();
  const last = await db.lastNudgeAt(c.var.user.id, body.toUserId);
  if (last !== undefined && now - last < NUDGE_COOLDOWN_MS) {
    return c.json({ error: "you already nudged them recently", code: "too_soon" }, 429);
  }

  const ledger = await db.findLedger(body.ledgerId);
  await db.insertNudge({
    id: uuidv7(),
    ledgerId: body.ledgerId,
    fromUserId: c.var.user.id,
    toUserId: body.toUserId,
    sentAt: now,
  });

  await notify(c.env, db, body.toUserId, {
    title: `${c.var.user.displayName} sent a reminder`,
    body: ledger ? `About ${ledger.name}` : "About a shared ledger",
    url: `/ledgers/${body.ledgerId}`,
  });

  return c.json({ ok: true });
});

/**
 * Deliver to one user's devices. Never called with more than one user.
 *
 * Best-effort by construction: push failure must never fail the action that
 * triggered it, so everything here is caught. A subscription the push service
 * reports as gone is retired so it is not retried forever.
 */
export async function notify(
  env: Env["Bindings"],
  db: Db,
  userId: string,
  message: PushMessage,
): Promise<void> {
  // `env` is optional-chained because push must degrade to a no-op wherever the
  // bindings are absent - an un-provisioned instance, and the route tests, which
  // mount routers without a Workers env. Push failing must never fail the action
  // that triggered it, and that starts here.
  const publicKey = env?.VAPID_PUBLIC_KEY;
  const privateKey = env?.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return; // push not provisioned on this instance

  let subs: Awaited<ReturnType<Db["listPushSubscriptions"]>>;
  try {
    subs = await db.listPushSubscriptions(userId);
  } catch {
    return;
  }

  // RFC 8292 wants a stable contact for the push service. The instance origin is
  // the honest one and is already a frozen constant - see ADR 0002.
  const keys = { publicKey, privateKey, subject: ORIGIN };
  for (const s of subs) {
    try {
      const res = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, message, keys);
      if (res.gone) await db.markPushFailed(s.endpoint, Date.now());
    } catch {
      // transient - leave the row alone and try again next time
    }
  }
}

export default push;

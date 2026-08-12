// Invites: single-use, 48 hours, revocable, bound to exactly one ledger.
//
// An invite enrols a NEW person. Re-enrolling an existing account is a recovery
// token instead (`recovery_tokens`) - an invite cannot do it without creating a
// second user and stranding the first one's history.
//
// A leaked link is still account access. The token is 256 bits from the platform
// CSPRNG, returned once, and stored only as a SHA-256 hash. Never log a token.
import { uuidv7 } from "~/shared/id";
import { randomToken, sha256Hex } from "~/server/auth/session";

export const INVITE_TTL_MS = 48 * 3_600_000;

/** The subset of `Db` this module needs. Method names match `~/db`. */
export type InviteStore = {
  insertInvite(row: {
    id: string;
    tokenHash: string;
    ledgerId: string;
    createdBy: string;
    createdAt: number;
    expiresAt: number;
  }): PromiseLike<unknown>;
  /** Unconsumed, unrevoked, unexpired, on a live ledger. Undefined otherwise -
   *  every rejection reason collapses to one, which is what we want on a token
   *  that is effectively a bearer credential. */
  findUsableInvite(
    tokenHash: string,
    now: number,
  ): Promise<{ invite: { id: string; ledgerId: string } } | undefined>;
  /** Conditional UPDATE: `SET consumed_at = ? WHERE id = ? AND consumed_at IS
   *  NULL`. `meta.changes` is the whole concurrency story. */
  consumeInvite(
    id: string,
    userId: string,
    at: number,
  ): PromiseLike<{ meta: { changes: number } }>;
  findMember(
    ledgerId: string,
    userId: string,
  ): Promise<{ id: string } | undefined>;
  insertMember(row: {
    id: string;
    ledgerId: string;
    userId: string;
    joinedAt: number;
  }): PromiseLike<unknown>;
};

export class InviteError extends Error {}

/** Returns the plaintext token - the only time it exists. Never log it. */
export async function createInvite(
  store: InviteStore,
  args: { ledgerId: string; createdBy: string; now: number },
): Promise<string> {
  const token = randomToken();
  await store.insertInvite({
    id: uuidv7(),
    tokenHash: await sha256Hex(token),
    ledgerId: args.ledgerId,
    createdBy: args.createdBy,
    createdAt: args.now,
    expiresAt: args.now + INVITE_TTL_MS,
  });
  return token;
}

/**
 * Consume an invite and join its ledger.
 *
 * D1 has no cross-request transaction, so the single-use guarantee rests on the
 * conditional UPDATE alone: whichever concurrent request flips consumed_at away
 * from NULL sees changes === 1 and wins; every other one sees 0 and fails. The
 * (ledger_id, user_id) unique index is the second line - even a claim that
 * somehow raced cannot produce two memberships.
 */
export async function acceptInvite(
  store: InviteStore,
  args: { token: string; userId: string; now: number },
): Promise<{ ledgerId: string; memberId: string }> {
  const row = await store.findUsableInvite(
    await sha256Hex(args.token),
    args.now,
  );
  if (!row) throw new InviteError("invite is not usable");
  const { id, ledgerId } = row.invite;

  const existing = await store.findMember(ledgerId, args.userId);
  if (existing) return { ledgerId, memberId: existing.id };

  const claimed = await store.consumeInvite(id, args.userId, args.now);
  if (claimed.meta.changes !== 1) throw new InviteError("invite is not usable");

  const memberId = uuidv7();
  await store.insertMember({
    id: memberId,
    ledgerId,
    userId: args.userId,
    joinedAt: args.now,
  });
  return { ledgerId, memberId };
}

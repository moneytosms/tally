// Real DB tests: node:sqlite in memory, migrated with the actual migration SQL.
// The (ledger_id, user_id) unique index is load-bearing here, so use real DDL.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:sqlite is untyped here — @types/node is not a dependency
import { DatabaseSync } from "node:sqlite";
import ddl from "../../../migrations/0000_calm_malice.sql?raw";
import {
  INVITE_TTL_MS,
  type InviteStore,
  acceptInvite,
  createInvite,
} from "~/server/auth/invite";
import { sha256Hex } from "~/server/auth/session";

const NOW = 1_760_000_000_000;

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...p: unknown[]): { changes: number };
    get(...p: unknown[]): Row | undefined;
    all(...p: unknown[]): Row[];
  };
};

function setup(): { sql: Sqlite; store: InviteStore } {
  const sql = new DatabaseSync(":memory:") as Sqlite;
  sql.exec(ddl);
  const user = sql.prepare(
    "INSERT INTO users (id, display_name, is_owner, created_at) VALUES (?,?,0,?)",
  );
  for (const id of ["u1", "u2", "u3"]) user.run(id, id, NOW);
  sql
    .prepare("INSERT INTO ledgers (id, name, created_by, created_at) VALUES (?,?,?,?)")
    .run("l1", "Goa", "u1", NOW);

  const store: InviteStore = {
    async insertInvite(r) {
      sql
        .prepare(
          "INSERT INTO invites (id, token_hash, ledger_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)",
        )
        .run(r.id, r.tokenHash, r.ledgerId, r.createdBy, r.createdAt, r.expiresAt);
    },
    async findUsableInvite(tokenHash, now) {
      const row = sql
        .prepare(
          `SELECT i.id, i.ledger_id FROM invites i
             JOIN ledgers l ON l.id = i.ledger_id
            WHERE i.token_hash = ? AND i.consumed_at IS NULL AND i.revoked_at IS NULL
              AND i.expires_at > ? AND l.deleted_at IS NULL`,
        )
        .get(tokenHash, now);
      return row
        ? { invite: { id: row.id as string, ledgerId: row.ledger_id as string } }
        : undefined;
    },
    async consumeInvite(id, userId, at) {
      const { changes } = sql
        .prepare(
          "UPDATE invites SET consumed_at = ?, consumed_by = ? WHERE id = ? AND consumed_at IS NULL",
        )
        .run(at, userId, id);
      return { meta: { changes } };
    },
    async findMember(ledgerId, userId) {
      const row = sql
        .prepare(
          "SELECT id FROM ledger_members WHERE ledger_id = ? AND user_id = ? AND left_at IS NULL AND deleted_at IS NULL",
        )
        .get(ledgerId, userId);
      return row ? { id: row.id as string } : undefined;
    },
    async insertMember(r) {
      sql
        .prepare(
          "INSERT INTO ledger_members (id, ledger_id, user_id, joined_at) VALUES (?,?,?,?)",
        )
        .run(r.id, r.ledgerId, r.userId, r.joinedAt);
    },
  };
  return { sql, store };
}

const revoke = (sql: Sqlite, id: string, at: number) =>
  sql.prepare("UPDATE invites SET revoked_at = ? WHERE id = ?").run(at, id);

const memberCount = (sql: Sqlite) =>
  sql.prepare("SELECT COUNT(*) AS n FROM ledger_members WHERE ledger_id = 'l1'").get()!.n;

const inviteId = (sql: Sqlite, tokenHash: string) =>
  sql.prepare("SELECT id FROM invites WHERE token_hash = ?").get(tokenHash)!.id as string;

const mint = (store: InviteStore) =>
  createInvite(store, { ledgerId: "l1", createdBy: "u1", now: NOW });

describe("invites", () => {
  it("stores only a hash of the token", async () => {
    const { sql, store } = setup();
    const token = await mint(store);
    const stored = sql.prepare("SELECT token_hash FROM invites").get()!.token_hash;
    expect(stored).not.toBe(token);
    expect(stored).toBe(await sha256Hex(token));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is single-use: a second accept fails and exactly one membership results", async () => {
    const { sql, store } = setup();
    const token = await mint(store);

    await expect(
      acceptInvite(store, { token, userId: "u2", now: NOW + 1000 }),
    ).resolves.toMatchObject({ ledgerId: "l1" });

    await expect(
      acceptInvite(store, { token, userId: "u3", now: NOW + 2000 }),
    ).rejects.toThrow("not usable");

    expect(memberCount(sql)).toBe(1);
  });

  it("the conditional UPDATE itself only ever claims once", async () => {
    const { sql, store } = setup();
    const token = await mint(store);
    const id = inviteId(sql, await sha256Hex(token));
    expect((await store.consumeInvite(id, "u2", NOW)).meta.changes).toBe(1);
    expect((await store.consumeInvite(id, "u3", NOW)).meta.changes).toBe(0);
  });

  it("accepting twice as the same user is idempotent, not a second row", async () => {
    const { sql, store } = setup();
    const a = await acceptInvite(store, { token: await mint(store), userId: "u2", now: NOW });
    const b = await acceptInvite(store, { token: await mint(store), userId: "u2", now: NOW });
    expect(b.memberId).toBe(a.memberId);
    expect(memberCount(sql)).toBe(1);
  });

  it("an expired invite fails", async () => {
    const { sql, store } = setup();
    const token = await mint(store);
    await expect(
      acceptInvite(store, { token, userId: "u2", now: NOW + INVITE_TTL_MS + 1 }),
    ).rejects.toThrow("not usable");
    expect(memberCount(sql)).toBe(0);
  });

  it("a revoked invite fails", async () => {
    const { sql, store } = setup();
    const token = await mint(store);
    revoke(sql, inviteId(sql, await sha256Hex(token)), NOW + 10);
    await expect(
      acceptInvite(store, { token, userId: "u2", now: NOW + 20 }),
    ).rejects.toThrow("not usable");
    expect(memberCount(sql)).toBe(0);
  });

  it("an invite on a soft-deleted ledger fails", async () => {
    const { sql, store } = setup();
    const token = await mint(store);
    sql.prepare("UPDATE ledgers SET deleted_at = ? WHERE id = 'l1'").run(NOW);
    await expect(
      acceptInvite(store, { token, userId: "u2", now: NOW + 20 }),
    ).rejects.toThrow("not usable");
  });

  it("an unknown token fails", async () => {
    const { store } = setup();
    await expect(
      acceptInvite(store, { token: "nope", userId: "u2", now: NOW }),
    ).rejects.toThrow("not usable");
  });
});

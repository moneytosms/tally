// Real DB tests: node:sqlite in memory, migrated with the actual migration SQL.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:sqlite is untyped here - @types/node is not a dependency
import { DatabaseSync } from "node:sqlite";
import ddl from "../../../migrations/0000_calm_malice.sql?raw";
import {
  SESSION_COOKIE,
  type SessionStore,
  createSession,
  destroySession,
  resolveSession,
  sessionCookie,
  sha256Hex,
} from "~/server/auth/session";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...p: unknown[]): { changes: number };
    get(...p: unknown[]): Row | undefined;
    all(...p: unknown[]): Row[];
  };
};

function setup(): { sql: Sqlite; store: SessionStore } {
  const sql = new DatabaseSync(":memory:") as Sqlite;
  sql.exec(ddl);
  sql
    .prepare("INSERT INTO users (id, display_name, is_owner, created_at) VALUES (?,?,?,?)")
    .run("u1", "Ada", 1, NOW);

  const store: SessionStore = {
    async insertSession(r) {
      sql
        .prepare(
          "INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?,?)",
        )
        .run(r.id, r.tokenHash, r.userId, r.createdAt, r.expiresAt, r.lastSeenAt, r.userAgent);
    },
    async findSessionByTokenHash(tokenHash, now) {
      const row = sql
        .prepare(
          `SELECT s.id, s.expires_at, s.last_seen_at, u.id AS uid, u.display_name, u.is_owner
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
        )
        .get(tokenHash, now);
      if (!row) return undefined;
      return {
        session: {
          id: row.id as string,
          expiresAt: row.expires_at as number,
          lastSeenAt: row.last_seen_at as number,
        },
        user: {
          id: row.uid as string,
          displayName: row.display_name as string,
          isOwner: row.is_owner === 1,
        },
      };
    },
    async touchSession(id, at, expiresAt) {
      sql
        .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
        .run(at, expiresAt, id);
    },
    async deleteSessionByTokenHash(tokenHash) {
      sql.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
  };
  return { sql, store };
}

describe("sessions", () => {
  it("stores only a sha256 hash, never the plaintext token", async () => {
    const { sql, store } = setup();
    const token = await createSession(store, "u1", NOW);

    const stored = sql.prepare("SELECT token_hash FROM sessions").get()!
      .token_hash as string;
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toBe(await sha256Hex(token));

    // and the plaintext appears nowhere in the row
    const row = JSON.stringify(sql.prepare("SELECT * FROM sessions").get());
    expect(row).not.toContain(token);
  });

  it("resolves a live session to its user", async () => {
    const { store } = setup();
    const token = await createSession(store, "u1", NOW);
    expect(await resolveSession(store, token, NOW + 1000)).toEqual({
      id: "u1",
      displayName: "Ada",
      isOwner: true,
    });
  });

  it("does not resolve an expired session", async () => {
    const { store } = setup();
    const token = await createSession(store, "u1", NOW);
    expect(await resolveSession(store, token, NOW + 31 * DAY)).toBeNull();
  });

  it("slides the window at most once a day", async () => {
    const { sql, store } = setup();
    const token = await createSession(store, "u1", NOW);
    const initial = sql.prepare("SELECT expires_at FROM sessions").get()!.expires_at;

    await resolveSession(store, token, NOW + 1000);
    expect(sql.prepare("SELECT expires_at FROM sessions").get()!.expires_at).toBe(initial);

    await resolveSession(store, token, NOW + 2 * DAY);
    expect(sql.prepare("SELECT last_seen_at FROM sessions").get()!.last_seen_at).toBe(
      NOW + 2 * DAY,
    );
  });

  it("logout deletes the row", async () => {
    const { sql, store } = setup();
    const token = await createSession(store, "u1", NOW);
    await destroySession(store, token);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n).toBe(0);
    expect(await resolveSession(store, token, NOW + 1000)).toBeNull();
  });

  it("cookie is HttpOnly, Secure, SameSite=Lax and host-only", () => {
    const cookie = sessionCookie("tok");
    expect(cookie.startsWith(`${SESSION_COOKIE}=tok;`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain");
  });
});

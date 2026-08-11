// Test-only: a real SQLite database (node:sqlite, in memory) behind the D1
// interface, so route tests exercise the actual data-access layer, the actual
// migration SQL and the actual middleware. Nothing here ships.
//
// Not named *.test.ts on purpose — vitest must not collect it.
// @ts-expect-error node:sqlite is untyped here — @types/node is not a dependency
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { createDb, type Db } from "~/db";
import type { Env } from "~/server/context";
import { SESSION_COOKIE, createSession } from "~/server/auth/session";

type Stmt = {
  all(...p: unknown[]): unknown[];
  run(...p: unknown[]): { changes: number };
  setReturnArrays(on: boolean): void;
};
type Sqlite = { exec(sql: string): void; prepare(sql: string): Stmt };

const clean = (params: unknown[]) => params.map((p) => (p === undefined ? null : p));

/** The slice of D1 the drizzle d1 driver actually calls. `batch` is wrapped in a
 *  transaction, which is what makes the "must not half-apply" tests meaningful. */
function asD1(sql: Sqlite) {
  const prepare = (query: string) => {
    const stmt = sql.prepare(query);
    const bind = (params: unknown[]) => ({
      bind: (...p: unknown[]) => bind(p),
      async run() {
        stmt.setReturnArrays(false);
        const { changes } = stmt.run(...clean(params));
        return { results: [], success: true, meta: { changes } };
      },
      async all() {
        stmt.setReturnArrays(false);
        return { results: stmt.all(...clean(params)), success: true, meta: {} };
      },
      async raw() {
        stmt.setReturnArrays(true);
        const rows = stmt.all(...clean(params));
        stmt.setReturnArrays(false);
        return rows;
      },
    });
    return bind([]);
  };

  return {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      sql.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sql.exec("COMMIT");
        return out;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

export const NOW = 1_760_000_000_000;

// Every migration, in order — so tests run against the schema production will
// actually have, not just the first migration. A new migration file is picked
// up automatically; one that does not apply cleanly fails every route test,
// which is exactly when you want to hear about it.
const MIGRATIONS = Object.entries(
  import.meta.glob("../../../migrations/*.sql", { query: "?raw", import: "default", eager: true }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql as string);

export function migrate(sql: Sqlite) {
  // node:sqlite exec() stops at the first statement in some builds, and the
  // `--> statement-breakpoint` markers are drizzle's own separators anyway.
  for (const file of MIGRATIONS) {
    for (const stmt of file.split("--> statement-breakpoint")) {
      if (stmt.trim()) sql.exec(stmt);
    }
  }
}

export type Harness = Awaited<ReturnType<typeof setup>>;

/**
 * Two ledgers so cross-ledger writes can be rejected in a test rather than in
 * production. L1: Ada, Bob and a guest. L2: Ada and Cy. Ada is the caller.
 */
export async function setup() {
  const sql = new DatabaseSync(":memory:") as Sqlite;
  migrate(sql);

  const user = sql.prepare("INSERT INTO users (id, display_name, vpa, is_owner, created_at) VALUES (?,?,?,?,?)");
  user.run("u_ada", "Ada", "ada@bank", 1, NOW);
  user.run("u_bob", "Bob", "bob@bank", 0, NOW);
  user.run("u_cy", "Cy", null, 0, NOW);

  const ledger = sql.prepare("INSERT INTO ledgers (id, name, created_by, created_at) VALUES (?,?,?,?)");
  ledger.run("L1", "Trip", "u_ada", NOW);
  ledger.run("L2", "Flat", "u_ada", NOW);

  const member = sql.prepare(
    "INSERT INTO ledger_members (id, ledger_id, user_id, guest_name, nickname, joined_at) VALUES (?,?,?,?,?,?)",
  );
  member.run("m_ada", "L1", "u_ada", null, "Ada", NOW);
  member.run("m_bob", "L1", "u_bob", null, "Bob", NOW + 1);
  member.run("m_guest", "L1", null, "Dee", "Dee", NOW + 2);
  member.run("n_ada", "L2", "u_ada", null, "Ada", NOW);
  member.run("n_cy", "L2", "u_cy", null, "Cy", NOW + 1);

  const db: Db = createDb(asD1(sql) as never);
  const token = await createSession(db, "u_ada", Date.now());
  return { sql, db, cookie: `${SESSION_COOKIE}=${token}` };
}

/** The routers under test, mounted exactly as src/server/index.ts mounts them. */
export function mount(h: Harness, ...routers: Array<Hono<Env>>) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("db", h.db);
    await next();
  });
  for (const r of routers) app.route("/api", r);
  return app;
}

export function req(h: Harness, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  return new Request(`http://tally.test${path}`, {
    ...rest,
    headers: { cookie: h.cookie, "content-type": "application/json", ...(rest.headers as object) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

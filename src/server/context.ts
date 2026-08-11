// Hono environment. Types only — no runtime code lives here.
import type { D1Database } from "@cloudflare/workers-types";
import type { Db } from "~/db";
import type { ledgerMembers } from "~/db/schema";

export type SessionUser = { id: string; displayName: string; isOwner: boolean };

export type LedgerMember = typeof ledgerMembers.$inferSelect;

export type Env = {
  Bindings: { DB: D1Database; BOOTSTRAP_SECRET: string };
  Variables: { db: Db; user: SessionUser; member: LedgerMember };
};

// Hono environment. Types only - no runtime code lives here.
import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Db } from "~/db";
import type { ledgerMembers } from "~/db/schema";

export type AccountType = "full" | "restricted";

export type SessionUser = {
  id: string;
  displayName: string;
  isOwner: boolean;
  accountType: AccountType;
};

export type LedgerMember = typeof ledgerMembers.$inferSelect;

export type Env = {
  Bindings: {
    DB: D1Database;
    BOOTSTRAP_SECRET: string;
    // Web Push. The public key is served to the browser so it can subscribe;
    // the private key signs and never leaves the Worker. Both optional: with
    // them unset push degrades to off rather than throwing (SPEC §9).
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    // One Durable Object drives every recurring series' alarm.
    RECURRING?: DurableObjectNamespace;
  };
  Variables: { db: Db; user: SessionUser; member: LedgerMember };
};

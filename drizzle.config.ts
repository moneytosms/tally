import { defineConfig } from "drizzle-kit";

// Cloudflare credentials do not exist yet — `generate` works offline without them;
// only `push`/`migrate` over d1-http read these env vars.
// (read via globalThis: @types/node is not installed and is not worth adding)
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env ?? {};

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: env.CLOUDFLARE_DATABASE_ID!,
    token: env.CLOUDFLARE_D1_TOKEN!,
  },
});

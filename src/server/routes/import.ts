// Import from a Splid .xls or Splitwise .csv export. Preview is read-only -
// it parses the uploaded bytes and hands back rows for the client to map
// source names onto members; nothing is written to the ledger until commit
// (see the commit route added alongside this one).
import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { parseSplidXls } from "~/shared/import/splid";
import { parseSplitwiseCsv } from "~/shared/import/splitwise";
import type { ParseResult } from "~/shared/import/types";

const PATH = "/ledgers/:ledgerId/import";

const importRouter = new Hono<Env>();
importRouter.use(`${PATH}/*`, requireSession, requireMember);

importRouter.post(`${PATH}/preview`, async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "no file uploaded" }, 400);

  const name = file.name.toLowerCase();
  let result: ParseResult;
  if (name.endsWith(".xls")) {
    result = parseSplidXls(await file.arrayBuffer());
  } else if (name.endsWith(".csv")) {
    result = parseSplitwiseCsv(await file.text());
  } else {
    return c.json({ error: "unrecognized file type - use a Splid .xls or Splitwise .csv export" }, 400);
  }

  return c.json(result);
});

export default importRouter;

// Import from a Splid .xls or Splitwise .csv export. Preview is read-only -
// it parses the uploaded bytes and hands back rows for the client to map
// source names onto members; nothing is written to the ledger until commit
// (see the commit route added alongside this one).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "~/server/context";
import { rejectArchivedWrites } from "~/server/routes/expenses";
import { requireMember } from "~/server/middleware/membership";
import { requireSession } from "~/server/middleware/session";
import { uuidv7 } from "~/shared/id";
import { parseSplidXls } from "~/shared/import/splid";
import { parseSplitwiseCsv } from "~/shared/import/splitwise";
import type { ParseResult } from "~/shared/import/types";
import { resolveSplits } from "~/shared/money";

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

const commitSchema = z.object({
  rows: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        amountPaise: z.int().positive(),
        dateMs: z.int().min(0),
        payerName: z.string().min(1),
        shares: z.array(z.object({ name: z.string().min(1), sharePaise: z.int() })).min(1),
      }),
    )
    .min(1),
  mapping: z.record(z.string(), z.string()),
  newGuests: z.record(z.string(), z.string()),
});

importRouter.use(`${PATH}/commit`, rejectArchivedWrites);
importRouter.post(`${PATH}/commit`, async (c) => {
  const db = c.var.db;
  const ledgerId = c.req.param("ledgerId");

  const parsed = commitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid import payload" }, 400);
  const { rows, mapping, newGuests } = parsed.data;

  if (Object.keys(newGuests).length > 0 && !c.var.user.isOwner) {
    return c.json({ error: "only the owner can create guests during import" }, 403);
  }

  // Every source name referenced by a row must resolve, either to an existing
  // member or to a new guest about to be created.
  const allNames = new Set<string>();
  for (const r of rows) {
    allNames.add(r.payerName);
    for (const s of r.shares) allNames.add(s.name);
  }
  for (const name of allNames) {
    if (!(name in mapping) && !(name in newGuests)) {
      return c.json({ error: `"${name}" is not mapped to a member or a new guest` }, 400);
    }
  }

  const now = Date.now();
  const guestIds = new Map<string, string>();
  for (const [sourceName, guestName] of Object.entries(newGuests)) {
    guestIds.set(sourceName, uuidv7());
    void guestName;
  }
  const memberIdOf = (sourceName: string) => mapping[sourceName] ?? guestIds.get(sourceName)!;

  // Guard against a member id from another ledger sneaking in via `mapping` -
  // same check checkMembers() does in expenses.ts for hand-typed expenses.
  const liveMembers = new Set((await db.listMembers(ledgerId)).map((m) => m.id));
  for (const memberId of Object.values(mapping)) {
    if (!liveMembers.has(memberId)) return c.json({ error: "a mapped member is not in this ledger" }, 400);
  }

  const statements = [];
  for (const [sourceName, guestName] of Object.entries(newGuests)) {
    statements.push(
      db.insertMember({
        id: guestIds.get(sourceName)!,
        ledgerId,
        userId: null,
        guestName,
        nickname: null,
        joinedAt: now,
        leftAt: null,
        deletedAt: null,
        pinned: false,
      }),
    );
  }

  for (const row of rows) {
    const expenseId = uuidv7();
    const participantNames = row.shares.map((s) => s.name);
    const payerIndex = participantNames.indexOf(row.payerName);
    if (payerIndex === -1) return c.json({ error: `"${row.title}": payer is not among the row's participants` }, 400);

    let amounts: number[];
    try {
      amounts = resolveSplits({
        total: row.amountPaise,
        mode: "shares",
        participantCount: participantNames.length,
        payerIndex,
        values: row.shares.map((s) => Math.max(1, s.sharePaise)), // shares mode requires positive weights
      });
    } catch (e) {
      return c.json({ error: `"${row.title}": ${(e as Error).message}` }, 400);
    }

    statements.push(
      db.insertExpense({
        id: expenseId,
        ledgerId,
        description: row.title,
        total: row.amountPaise,
        paidAt: row.dateMs,
        payerMemberId: memberIdOf(row.payerName),
        categoryId: null,
        notes: "Imported",
        mode: "shares",
        createdBy: c.var.user.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
    statements.push(
      db.insertSplits(
        row.shares.map((s, i) => ({
          id: uuidv7(),
          expenseId,
          memberId: memberIdOf(s.name),
          amount: amounts[i]!,
          inputValue: s.sharePaise,
          sortOrder: i,
        })),
      ),
    );
  }

  // @ts-expect-error - statements is built incrementally with mixed insert kinds; batch's tuple type wants a literal, this is the same pattern other multi-row batches in this codebase fall back to.
  await db.batch(statements);

  return c.json({ created: rows.length });
});

export default importRouter;

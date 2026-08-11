// The alarm that drives recurring expenses.
//
// SPEC §9: "one alarm per recurring series, plus one nightly backup alarm. No
// sweeps, no cron across users." This is a single Durable Object holding one
// alarm for the whole instance, set to the earliest due series — which is
// strictly less work than one object per series and, at ~20 users, cannot fall
// behind. If a single instance ever outgrows that, shard by ledger id; the
// catch-up logic in ~/server/recurring is already per-series and would not change.
//
// Everything interesting is in `runCatchUp`, which is pure of Workers concerns
// and tested in src/server/recurring.test.ts. This file is the thin shell: it
// decides WHEN to run and re-arms the alarm. Keep it thin — it is the part that
// cannot be unit-tested without workerd.
import type { D1Database, DurableObjectState } from "@cloudflare/workers-types";
import { createDb } from "~/db";
import { cadenceOf, runCatchUp } from "~/server/recurring";
import { nextAlarmAt } from "~/shared/recurrence";

export type RecurringEnv = { DB: D1Database };

/** Never sleep longer than this, so a series created while the alarm was far in
 *  the future is still picked up promptly. */
const MAX_SLEEP_MS = 6 * 60 * 60 * 1000; // 6 hours

export class RecurringAlarm {
  constructor(
    private state: DurableObjectState,
    private env: RecurringEnv,
  ) {}

  /** Called by the API whenever a series is created, edited, paused or deleted. */
  async fetch(): Promise<Response> {
    await this.reschedule();
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    const db = createDb(this.env.DB);
    const now = Date.now();

    // listDueSeries already excludes paused series, deleted series, and series
    // on archived or deleted ledgers — an archived ledger cancels its alarms by
    // simply never appearing here.
    const due = await db.listDueSeries(now);
    let drainAgain = false;

    for (const { series } of due) {
      const result = await runCatchUp(db, series, now);
      // The cursor advance is a separate write from the inserts on purpose: if
      // the worker dies between them, the unique index makes the replay a no-op
      // rather than a duplicate. Advancing first would silently skip occurrences.
      if (result.cursor !== series.nextOccurrenceAt) {
        await db.updateSeries(series.id, { nextOccurrenceAt: result.cursor });
      }
      if (result.more) drainAgain = true;
    }

    await this.reschedule(drainAgain);
  }

  /** Arm the alarm for the earliest work outstanding. */
  private async reschedule(immediate = false): Promise<void> {
    if (immediate) {
      await this.state.storage.setAlarm(Date.now() + 1000);
      return;
    }

    const db = createDb(this.env.DB);
    const now = Date.now();
    const all = await db.listDueSeries(now + MAX_SLEEP_MS);

    let earliest: number | null = null;
    for (const { series } of all) {
      const at = nextAlarmAt(cadenceOf(series), series.nextOccurrenceAt);
      if (at !== null && (earliest === null || at < earliest)) earliest = at;
    }

    if (earliest === null) {
      // Nothing scheduled anywhere. Drop the alarm rather than idling on a timer.
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Math.max(earliest, now + 1000));
  }
}

/**
 * Poke the alarm object after any change to a series. Best-effort: a failure
 * here delays a recurring expense, it never loses one, because the next alarm
 * re-derives everything from the database rather than from in-memory state.
 */
export async function pokeRecurring(ns: DurableObjectNamespace | undefined): Promise<void> {
  if (!ns) return; // binding absent (local dev, or push/recurring not provisioned)
  try {
    const id = ns.idFromName("singleton");
    await ns.get(id).fetch("https://recurring.internal/poke");
  } catch {
    // swallowed deliberately — see above
  }
}

type DurableObjectNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string): Promise<unknown> };
};

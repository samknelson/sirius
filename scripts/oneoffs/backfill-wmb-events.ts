/**
 * Event-only historical WMB backfill. Preview is the default.
 * Usage: npx tsx scripts/oneoffs/backfill-wmb-events.ts --cutoff=2025-12
 *        npx tsx scripts/oneoffs/backfill-wmb-events.ts --cutoff=2025-12 --live
 */
import { storage } from "../../server/storage/database";
import { pool } from "../../server/storage/db";
import { drainStorageSideEffects } from "../../server/storage/drain-storage-side-effects";
import { monthKey } from "../../server/services/wmb-historical-inference";

function options(argv: string[]) {
  const named = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--(cutoff|worker|benefit|after-worker|limit)(?:=(.+))?$/.exec(arg);
    if (arg === "--live") { named.set("live", "true"); continue; }
    if (!match || !match[2] || named.has(match[1])) throw new Error(`Invalid or duplicate argument: ${arg}`);
    named.set(match[1], match[2]);
  }
  const date = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(named.get("cutoff") ?? "");
  if (!date) throw new Error("Required --cutoff=YYYY-MM (inclusive complete-history month)");
  const limit = Number(named.get("limit") ?? "500");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error("--limit must be 1..5000");
  return {
    cutoff: monthKey(Number(date[1]), Number(date[2])),
    live: named.has("live"),
    worker: named.get("worker"),
    benefit: named.get("benefit"),
    after: named.get("after-worker") ?? "",
    limit,
  };
}

export async function runHistoricalBackfill(argv: string[], target = storage.trustWmbEvents) {
  const opts = options(argv);
  const workers = await target.pageHistoricalWorkers(opts.after, opts.limit + 1, opts.benefit, opts.worker);
  const hasMore = workers.length > opts.limit;
  const page = workers.slice(0, opts.limit);
  const totals = { created: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0 };
  const groups = new Map<string, { type: string; benefitId: string; month: string; created: number; unchanged: number; removed: number; skipped: number; samples: string[] }>();
  for (const workerId of page) {
    try {
      const decisions = await target.reconcileHistoricalWorker(workerId, opts.cutoff, opts.benefit, !opts.live);
      for (const event of decisions) {
        totals[event.change]++;
        const month = `${event.year}-${String(event.month).padStart(2, "0")}`;
        const key = `${event.eventType}:${event.benefitId}:${month}`;
        let group = groups.get(key);
        if (!group) {
          group = { type: event.eventType, benefitId: event.benefitId, month,
            created: 0, unchanged: 0, removed: 0, skipped: 0, samples: [] };
          groups.set(key, group);
        }
        group[event.change]++;
        if (group.samples.length < 3) group.samples.push(`${workerId}:${event.change}`);
      }
    } catch (error) {
      totals.failed++;
      console.error(JSON.stringify({ workerId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  const result = {
    mode: opts.live ? "live" : "preview",
    cutoff: `${Math.floor((opts.cutoff - 1) / 12)}-${String((opts.cutoff - 1) % 12 + 1).padStart(2, "0")}`,
    workers: page.length, totals,
    byTypeBenefitMonth: [...groups.values()].sort((a, b) =>
      `${a.type}:${a.benefitId}:${a.month}`.localeCompare(`${b.type}:${b.benefitId}:${b.month}`)),
    nextAfterWorker: hasMore ? page.at(-1) : null,
    incomplete: hasMore || totals.failed > 0,
  };
  return result;
}

if (process.argv[1]?.endsWith("backfill-wmb-events.ts")) {
  void (async () => {
    try {
      const result = await runHistoricalBackfill(process.argv.slice(2));
      console.log(JSON.stringify(result, null, 2));
      if (result.incomplete) process.exitCode = 2;
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      try {
        await drainStorageSideEffects();
        await pool.end();
      } catch (error) {
        console.error("Failed to close storage cleanly", error);
        process.exitCode = 1;
      }
    }
  })();
}
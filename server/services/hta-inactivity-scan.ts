import { storage } from "../storage";
import { getClient } from "../storage/transaction-context";
import {
  workers,
  workerWsh,
  optionsWorkerWs,
  optionsWorkerMs,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { logger } from "../logger";

export interface InactivityScanResult {
  scanned: number;
  deactivated: number;
  alreadyInactive: number;
  errors: string[];
}

export async function runInactivityScan(): Promise<InactivityScanResult> {
  const result: InactivityScanResult = {
    scanned: 0,
    deactivated: 0,
    alreadyInactive: 0,
    errors: [],
  };

  const client = getClient();

  const allMsOptions = await client
    .select()
    .from(optionsWorkerMs)
    .where(sql`LOWER(${optionsWorkerMs.name}) = 'union'`);

  const unionMsOption = allMsOptions[0];
  if (!unionMsOption) {
    result.errors.push('No "Union" member status option found in options_worker_ms');
    return result;
  }

  const allWsOptions = await client.select().from(optionsWorkerWs);

  const activeWsOption = allWsOptions.find(
    (o) => o.name.toLowerCase() === "active"
  );
  const inactiveWsOption = allWsOptions.find(
    (o) => o.name.toLowerCase() === "inactive"
  );

  if (!activeWsOption) {
    result.errors.push('No "Active" work status option found in options_worker_ws');
    return result;
  }
  if (!inactiveWsOption) {
    result.errors.push('No "Inactive" work status option found in options_worker_ws');
    return result;
  }

  const unionWorkers = await client
    .select({
      id: workers.id,
      denormWsId: workers.denormWsId,
    })
    .from(workers)
    .where(sql`${workers.denormMsIds} @> ARRAY[${unionMsOption.id}]::varchar[]`);

  result.scanned = unionWorkers.length;

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const threeMonthsAgoStr = threeMonthsAgo.toISOString().split("T")[0];

  const today = new Date().toISOString().split("T")[0];

  for (const worker of unionWorkers) {
    try {
      if (worker.denormWsId !== activeWsOption.id) {
        result.alreadyInactive++;
        continue;
      }

      const [lastActiveEntry] = await client
        .select({ date: workerWsh.date })
        .from(workerWsh)
        .where(
          and(
            eq(workerWsh.workerId, worker.id),
            eq(workerWsh.wsId, activeWsOption.id)
          )
        )
        .orderBy(desc(workerWsh.date), sql`${workerWsh.createdAt} DESC NULLS LAST`)
        .limit(1);

      const shouldDeactivate =
        !lastActiveEntry || lastActiveEntry.date <= threeMonthsAgoStr;

      if (shouldDeactivate) {
        await storage.workerWsh.createWorkerWsh({
          workerId: worker.id,
          date: today,
          wsId: inactiveWsOption.id,
          data: { source: "hta_inactivity_scan" },
        });
        result.deactivated++;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Error processing worker ${worker.id}: ${message}`
      );
      logger.error(`Inactivity scan error for worker ${worker.id}`, {
        service: "hta-inactivity-scan",
        error: message,
      });
    }
  }

  logger.info(
    `Inactivity scan complete: scanned=${result.scanned}, deactivated=${result.deactivated}, alreadyInactive=${result.alreadyInactive}, errors=${result.errors.length}`,
    { service: "hta-inactivity-scan" }
  );

  return result;
}

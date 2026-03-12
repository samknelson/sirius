import { storage } from "../storage";
import { getClient } from "../storage/transaction-context";
import {
  workers,
  workerWsh,
  optionsWorkerWs,
  optionsWorkerMs,
  contacts,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { logger } from "../logger";

export interface WorkerScanDetail {
  workerId: string;
  workerName: string;
  currentStatus: string;
  lastActiveDate: string | null;
  action: "deactivated" | "already_inactive" | "still_active" | "not_union" | "error";
  reason: string;
}

export interface InactivityScanResult {
  scanned: number;
  deactivated: number;
  alreadyInactive: number;
  stillActive: number;
  errors: string[];
  mode: "live" | "test";
  details: WorkerScanDetail[];
}

export interface ScanOptions {
  mode?: "live" | "test";
  workerId?: string;
}

async function getWorkerName(client: any, workerId: string): Promise<string> {
  const rows = await client
    .select({ given: contacts.given, family: contacts.family })
    .from(contacts)
    .innerJoin(workers, eq(workers.contactId, contacts.id))
    .where(eq(workers.id, workerId));
  return rows[0] ? `${rows[0].given || ''} ${rows[0].family || ''}`.trim() : workerId;
}

async function getMostRecentWshStatus(
  client: any,
  workerId: string
): Promise<{ wsId: string; date: string } | null> {
  const [entry] = await client
    .select({ wsId: workerWsh.wsId, date: workerWsh.date })
    .from(workerWsh)
    .where(eq(workerWsh.workerId, workerId))
    .orderBy(desc(workerWsh.date), sql`${workerWsh.createdAt} DESC NULLS LAST`)
    .limit(1);
  return entry || null;
}

export async function runInactivityScan(options?: ScanOptions): Promise<InactivityScanResult> {
  const mode = options?.mode || "test";
  const targetWorkerId = options?.workerId;

  const result: InactivityScanResult = {
    scanned: 0,
    deactivated: 0,
    alreadyInactive: 0,
    stillActive: 0,
    errors: [],
    mode,
    details: [],
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

  const wsMap = new Map(allWsOptions.map(o => [o.id, o.name]));

  let targetWorkers: Array<{ id: string }>;

  if (targetWorkerId) {
    const [worker] = await client
      .select({ id: workers.id, denormMsIds: workers.denormMsIds })
      .from(workers)
      .where(eq(workers.id, targetWorkerId));

    if (!worker) {
      result.errors.push(`Worker ${targetWorkerId} not found`);
      return result;
    }

    const msIds = worker.denormMsIds || [];
    if (!msIds.includes(unionMsOption.id)) {
      const workerName = await getWorkerName(client, targetWorkerId);
      const mostRecent = await getMostRecentWshStatus(client, targetWorkerId);
      const currentStatusName = mostRecent ? (wsMap.get(mostRecent.wsId) || 'Unknown') : 'No entries';

      result.scanned = 1;
      result.details.push({
        workerId: targetWorkerId,
        workerName,
        currentStatus: currentStatusName,
        lastActiveDate: null,
        action: "not_union",
        reason: "Worker does not have Union member status",
      });
      return result;
    }

    targetWorkers = [{ id: worker.id }];
  } else {
    targetWorkers = await client
      .select({ id: workers.id })
      .from(workers)
      .where(sql`${workers.denormMsIds} @> ARRAY[${unionMsOption.id}]::varchar[]`);
  }

  result.scanned = targetWorkers.length;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  const threeMonthsAgoStr = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-${String(threeMonthsAgo.getDate()).padStart(2, '0')}`;

  for (const worker of targetWorkers) {
    try {
      const workerName = await getWorkerName(client, worker.id);

      const mostRecent = await getMostRecentWshStatus(client, worker.id);
      const currentWsId = mostRecent?.wsId || null;
      const currentStatusName = currentWsId ? (wsMap.get(currentWsId) || 'Unknown') : 'No entries';

      if (currentWsId !== activeWsOption.id) {
        result.alreadyInactive++;
        result.details.push({
          workerId: worker.id,
          workerName,
          currentStatus: currentStatusName,
          lastActiveDate: null,
          action: "already_inactive",
          reason: `Most recent work status is "${currentStatusName}" (not Active)`,
        });
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

      const lastActiveDateStr = lastActiveEntry?.date || null;

      const shouldDeactivate =
        !lastActiveEntry || lastActiveEntry.date <= threeMonthsAgoStr;

      if (shouldDeactivate) {
        if (mode === "live") {
          await storage.workerWsh.createWorkerWsh({
            workerId: worker.id,
            date: today,
            wsId: inactiveWsOption.id,
            data: { source: "hta_inactivity_scan" },
          });
        }
        result.deactivated++;
        result.details.push({
          workerId: worker.id,
          workerName,
          currentStatus: currentStatusName,
          lastActiveDate: lastActiveDateStr,
          action: "deactivated",
          reason: lastActiveEntry
            ? `Last Active entry on ${lastActiveDateStr} is older than 3 months (cutoff: ${threeMonthsAgoStr})`
            : `No Active work status entry found`,
        });
      } else {
        result.stillActive++;
        result.details.push({
          workerId: worker.id,
          workerName,
          currentStatus: currentStatusName,
          lastActiveDate: lastActiveDateStr,
          action: "still_active",
          reason: `Last Active entry on ${lastActiveDateStr} is within 3 months`,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Error processing worker ${worker.id}: ${message}`
      );
      result.details.push({
        workerId: worker.id,
        workerName: worker.id,
        currentStatus: "Unknown",
        lastActiveDate: null,
        action: "error",
        reason: message,
      });
      logger.error(`Inactivity scan error for worker ${worker.id}`, {
        service: "hta-inactivity-scan",
        error: message,
      });
    }
  }

  logger.info(
    `Inactivity scan complete (${mode}): scanned=${result.scanned}, deactivated=${result.deactivated}, alreadyInactive=${result.alreadyInactive}, errors=${result.errors.length}`,
    { service: "hta-inactivity-scan" }
  );

  return result;
}

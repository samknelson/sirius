import { storage } from "../../../../storage";
import { logger } from "../../../../logger";

interface T631WorkerRow {
  worker_id?: unknown;
  worker_ein?: unknown;
  [key: string]: unknown;
}

interface T631WorkerListResponse {
  success: boolean;
  data?: { workers?: unknown };
  [key: string]: unknown;
}

export interface WorkerEinSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}

export async function syncWorkerEins(
  responseData: T631WorkerListResponse,
  dryRun: boolean,
): Promise<WorkerEinSyncResult> {
  const result: WorkerEinSyncResult = {
    created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, details: [],
  };

  if (!responseData.success || !responseData.data) {
    logger.warn("T631 worker list returned unsuccessful or empty data", {
      service: "t631-sync-workers",
      success: responseData.success,
    });
    return result;
  }

  const rawWorkers = responseData.data.workers;
  let rows: T631WorkerRow[];
  if (Array.isArray(rawWorkers)) {
    rows = rawWorkers as T631WorkerRow[];
  } else if (rawWorkers && typeof rawWorkers === "object") {
    rows = Object.values(rawWorkers) as T631WorkerRow[];
  } else {
    const msg = "T631 worker list payload data.workers must be an array or object of worker rows";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(payload)", action: "error", error: msg });
    return result;
  }

  const t631TypeId = await storage.workerIds.getTypeIdBySiriusId("t631");
  if (!t631TypeId) {
    const msg = "Cannot sync T631 worker EINs: no options_worker_id_type row with sirius_id='t631'";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(config)", action: "error", error: msg });
    return result;
  }

  const einTypeId = await storage.workerIds.getTypeIdBySiriusId("freeman_ein");
  if (!einTypeId) {
    const msg = "Cannot sync T631 worker EINs: no options_worker_id_type row with sirius_id='freeman_ein'";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(config)", action: "error", error: msg });
    return result;
  }

  // Track EINs seen this run so a duplicate remote EIN is reported, not double-written.
  const seenEins = new Map<string, string>(); // ein -> remoteWorkerId that claimed it

  for (const row of rows) {
    const remoteWorkerId = row.worker_id !== undefined && row.worker_id !== null ? String(row.worker_id).trim() : "";
    const ein = row.worker_ein !== undefined && row.worker_ein !== null ? String(row.worker_ein).trim() : "";

    if (!remoteWorkerId) {
      result.skipped++;
      result.details.push({ remoteWorkerId: "(empty)", action: "skipped", error: "Missing worker_id" });
      continue;
    }
    if (!ein) {
      result.skipped++;
      result.details.push({ remoteWorkerId, action: "skipped", error: "Missing worker_ein" });
      continue;
    }

    try {
      const firstClaimant = seenEins.get(ein);
      if (firstClaimant !== undefined) {
        result.skipped++;
        result.details.push({
          remoteWorkerId,
          action: "skipped",
          error: `duplicate_ein: EIN ${ein} already appeared on remote worker_id=${firstClaimant}`,
        });
        continue;
      }

      const t631Row = await storage.workerIds.getWorkerIdByTypeAndValue(t631TypeId, remoteWorkerId);
      if (!t631Row) {
        result.skipped++;
        result.details.push({ remoteWorkerId, action: "skipped", error: `worker_not_found (t631=${remoteWorkerId})` });
        continue;
      }
      const localWorkerId = t631Row.workerId;
      const wd = (action: string, error?: string) => ({
        workerId: localWorkerId,
        remoteWorkerId,
        action,
        ...(error ? { error } : {}),
      });

      // Conflict: EIN already held by a different local worker.
      const existingHolder = await storage.workerIds.getWorkerIdByTypeAndValue(einTypeId, ein);
      if (existingHolder && existingHolder.workerId !== localWorkerId) {
        result.skipped++;
        result.details.push(wd("skipped", `ein_conflict: EIN ${ein} already held by another worker (workerId=${existingHolder.workerId})`));
        continue;
      }

      seenEins.set(ein, remoteWorkerId);

      // Does this worker already have a freeman_ein row?
      const allIds = await storage.workerIds.getWorkerIdsByWorkerId(localWorkerId);
      const einRows = allIds.filter((w) => w.typeId === einTypeId);

      if (einRows.length > 1) {
        result.skipped++;
        result.details.push(wd("skipped", `multiple_ein_rows: worker has ${einRows.length} freeman_ein rows; resolve manually`));
        continue;
      }

      const existing = einRows[0];
      if (existing) {
        if (existing.value === ein) {
          result.unchanged++;
          result.details.push(wd(dryRun ? "would_be_unchanged" : "unchanged"));
        } else if (dryRun) {
          result.updated++;
          result.details.push(wd("would_update", `value ${existing.value} -> ${ein}`));
        } else {
          await storage.workerIds.updateWorkerId(existing.id, { value: ein });
          result.updated++;
          result.details.push(wd("updated", `value ${existing.value} -> ${ein}`));
        }
      } else if (dryRun) {
        result.created++;
        result.details.push(wd("would_create"));
      } else {
        await storage.workerIds.createWorkerId({
          workerId: localWorkerId,
          typeId: einTypeId,
          value: ein,
        });
        result.created++;
        result.details.push(wd("created"));
      }
    } catch (error) {
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ remoteWorkerId, action: "error", error: errMsg });
      logger.error(`Failed to sync T631 worker EIN for worker_id=${remoteWorkerId}`, {
        service: "t631-sync-workers",
        error: errMsg,
      });
    }
  }

  return result;
}

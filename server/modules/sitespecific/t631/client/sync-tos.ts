import { storage } from "../../../../storage";
import { logger } from "../../../../logger";
import { optionsWorkerIdType } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../../../storage/db";
import { WorkerTosConflictError } from "../../../../storage/worker-tos";

interface T631TosNode {
  nid?: unknown;
  worker_id?: unknown;
  created?: unknown;
  field_sirius_summary?: { und?: Array<{ value?: unknown }> };
  [key: string]: unknown;
}

interface T631TosResponse {
  success: boolean;
  data?: { tos_nodes?: Record<string, T631TosNode> };
  [key: string]: unknown;
}

interface SyncResult {
  created: number;
  reopened: number;
  updated: number;
  unchanged: number;
  terminated: number;
  skipped: number;
  errors: number;
  details: Array<{ workerId?: string; siriusId: string; action: string; error?: string }>;
}

function extractDescription(node: T631TosNode): string | null {
  const v = node.field_sirius_summary?.und?.[0]?.value;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function parseStartDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  const d = new Date(num * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function syncTos(
  responseData: T631TosResponse,
  dryRun: boolean,
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0, reopened: 0, updated: 0, unchanged: 0,
    terminated: 0, skipped: 0, errors: 0, details: [],
  };

  if (!responseData.success || !responseData.data?.tos_nodes) {
    logger.warn("T631 TOS list returned unsuccessful or empty data", {
      service: "t631-sync-tos",
      success: responseData.success,
    });
    return result;
  }

  const tosNodes = responseData.data.tos_nodes;
  if (typeof tosNodes !== "object" || Array.isArray(tosNodes)) {
    const msg = "T631 TOS payload data.tos_nodes must be a non-array object keyed by nid";
    logger.error(msg, { service: "t631-sync-tos" });
    result.errors++;
    result.details.push({ siriusId: "(payload)", action: "error", error: msg });
    return result;
  }

  // Resolve t631 worker_id type id (sirius_id = "t631")
  const [t631Type] = await db
    .select({ id: optionsWorkerIdType.id })
    .from(optionsWorkerIdType)
    .where(eq(optionsWorkerIdType.siriusId, "t631"))
    .limit(1);

  if (!t631Type) {
    const msg = "Cannot sync T631 TOS: no options_worker_id_type row with sirius_id='t631'";
    logger.error(msg, { service: "t631-sync-tos" });
    result.errors++;
    result.details.push({ siriusId: "(config)", action: "error", error: msg });
    return result;
  }
  const t631TypeId = t631Type.id;

  const remoteSiriusIds = new Set<string>();

  for (const [, rawNode] of Object.entries(tosNodes)) {
    const node = rawNode as T631TosNode;
    const siriusId = node.nid !== undefined && node.nid !== null ? String(node.nid).trim() : "";
    const remoteWorkerId = node.worker_id !== undefined && node.worker_id !== null ? String(node.worker_id).trim() : "";
    const startDate = parseStartDate(node.created);
    const description = extractDescription(node);

    if (!siriusId) {
      result.skipped++;
      result.details.push({ siriusId: "(empty)", action: "skipped", error: "Missing nid" });
      continue;
    }
    remoteSiriusIds.add(siriusId);

    if (!remoteWorkerId) {
      result.skipped++;
      result.details.push({ siriusId, action: "skipped", error: "Missing worker_id" });
      continue;
    }
    if (!startDate) {
      result.skipped++;
      result.details.push({ siriusId, action: "skipped", error: "Missing or invalid created date" });
      continue;
    }

    try {
      const workerIdRow = await storage.workerIds.getWorkerIdByTypeAndValue(t631TypeId, remoteWorkerId);
      if (!workerIdRow) {
        result.skipped++;
        result.details.push({ siriusId, action: "skipped", error: `worker_not_found (t631=${remoteWorkerId})` });
        continue;
      }
      const localWorkerId = workerIdRow.workerId;
      const wd = (action: string, error?: string) => ({ workerId: localWorkerId, siriusId, action, ...(error ? { error } : {}) });

      const existing = await storage.workerTos.getBySiriusId(siriusId);

      if (existing) {
        const startMs = existing.startDate ? new Date(existing.startDate).getTime() : 0;
        const sameStart = startMs === startDate.getTime();
        const sameDesc = (existing.description ?? null) === description;
        const sameWorker = existing.workerId === localWorkerId;
        const stillActive = existing.endDate === null;

        if (!stillActive) {
          // Closed locally but still active remotely -> re-open if no conflict
          const activeForWorker = await storage.workerTos.getActiveForWorker(localWorkerId);
          if (activeForWorker && activeForWorker.id !== existing.id) {
            result.skipped++;
            result.details.push(wd("skipped", `cannot_reopen: worker has another active record (id=${activeForWorker.id})`));
            continue;
          }
          if (dryRun) {
            result.reopened++;
            result.details.push(wd("would_reopen"));
          } else {
            try {
              await storage.workerTos.update(existing.id, {
                workerId: localWorkerId,
                endDate: null,
                startDate,
                description,
              });
              result.reopened++;
              result.details.push(wd("reopened"));
            } catch (err) {
              if (err instanceof WorkerTosConflictError) {
                result.skipped++;
                result.details.push(wd("skipped", `conflict: ${err.message}`));
              } else {
                throw err;
              }
            }
          }
        } else if (sameStart && sameDesc && sameWorker) {
          result.unchanged++;
          result.details.push(wd(dryRun ? "would_be_unchanged" : "unchanged"));
        } else {
          // Worker reassignment requires no other active row for the new worker
          if (!sameWorker) {
            const activeForNew = await storage.workerTos.getActiveForWorker(localWorkerId);
            if (activeForNew && activeForNew.id !== existing.id) {
              result.skipped++;
              result.details.push(wd("skipped", `cannot_reassign: target worker already has active record (id=${activeForNew.id})`));
              continue;
            }
          }
          if (dryRun) {
            result.updated++;
            result.details.push(wd("would_update"));
          } else {
            try {
              await storage.workerTos.update(existing.id, {
                workerId: localWorkerId,
                startDate,
                description,
              });
              result.updated++;
              result.details.push(wd("updated"));
            } catch (err) {
              if (err instanceof WorkerTosConflictError) {
                result.skipped++;
                result.details.push(wd("skipped", `conflict: ${err.message}`));
              } else {
                throw err;
              }
            }
          }
        }
      } else {
        // New remote record - check for manual active conflict
        const activeForWorker = await storage.workerTos.getActiveForWorker(localWorkerId);
        if (activeForWorker) {
          result.skipped++;
          result.details.push(wd("skipped", `manual_conflict: worker already has active record (id=${activeForWorker.id}, siriusId=${activeForWorker.siriusId ?? "none"})`));
          continue;
        }
        if (dryRun) {
          result.created++;
          result.details.push(wd("would_create"));
        } else {
          try {
            await storage.workerTos.create({
              workerId: localWorkerId,
              siriusId,
              startDate,
              endDate: null,
              description,
            });
            result.created++;
            result.details.push(wd("created"));
          } catch (err) {
            if (err instanceof WorkerTosConflictError) {
              result.skipped++;
              result.details.push(wd("skipped", `conflict: ${err.message}`));
            } else {
              throw err;
            }
          }
        }
      }
    } catch (error) {
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ siriusId, action: "error", error: errMsg });
      // (workerId may not be resolved at this point — omitted)
      logger.error(`Failed to sync T631 TOS siriusId=${siriusId}`, {
        service: "t631-sync-tos",
        error: errMsg,
      });
    }
  }

  // Phase 2: terminate any local active records whose siriusId is no longer in the remote set,
  // but only for workers that have a t631 worker_id row.
  try {
    const activeLocal = await storage.workerTos.listActive();
    for (const row of activeLocal) {
      if (!row.siriusId) continue; // skip manual records
      if (remoteSiriusIds.has(row.siriusId)) continue;

      // Confirm this worker is a T631 worker
      const wIds = await storage.workerIds.getWorkerIdsByWorkerId(row.workerId);
      const isT631 = wIds.some((w) => w.typeId === t631TypeId);
      if (!isT631) {
        result.skipped++;
        result.details.push({
          workerId: row.workerId,
          siriusId: row.siriusId,
          action: "skipped",
          error: "not_t631_worker",
        });
        continue;
      }

      if (dryRun) {
        result.terminated++;
        result.details.push({ workerId: row.workerId, siriusId: row.siriusId, action: "would_terminate" });
      } else {
        try {
          await storage.workerTos.update(row.id, { endDate: new Date() });
          result.terminated++;
          result.details.push({ workerId: row.workerId, siriusId: row.siriusId, action: "terminated" });
        } catch (err) {
          if (err instanceof WorkerTosConflictError) {
            result.skipped++;
            result.details.push({ workerId: row.workerId, siriusId: row.siriusId, action: "skipped", error: `conflict: ${err.message}` });
          } else {
            result.errors++;
            const errMsg = err instanceof Error ? err.message : String(err);
            result.details.push({ workerId: row.workerId, siriusId: row.siriusId, action: "error", error: `terminate_failed: ${errMsg}` });
            logger.error(`Failed to terminate T631 TOS siriusId=${row.siriusId}`, {
              service: "t631-sync-tos",
              error: errMsg,
            });
          }
        }
      }
    }
  } catch (error) {
    result.errors++;
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed phase-2 termination scan for T631 TOS sync", {
      service: "t631-sync-tos",
      error: errMsg,
    });
  }

  return result;
}

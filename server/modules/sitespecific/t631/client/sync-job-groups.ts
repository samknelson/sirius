import { storage } from "../../../../storage";
import { logger } from "../../../../logger";
import type { I'm InsertDispatchJobGroup } from "@shared/schema";

interface T631GroupRecord {
  nid: string;
  uuid?: string;
  title: string;
  field_sirius_datetime?: { und?: Array<{ value: string }> };
  field_sirius_datetime_completed?: { und?: Array<{ value: string }> };
  [key: string]: unknown;
}

interface T631GroupSearchResponse {
  success: boolean;
  data?: Record<string, T631GroupRecord>;
  [key: string]: unknown;
}

interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  details: Array<{ name: string; action: string; error?: string }>;
}

function extractYmd(datetimeField: { und?: Array<{ value: string }> } | undefined): string | null {
  const raw = datetimeField?.und?.[0]?.value;
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractSiriusId(record: T631GroupRecord): string | null {
  return record.uuid || record.nid || null;
}

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + sorted.map(k => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
}

export async function syncJobGroups(
  responseData: T631GroupSearchResponse,
  dryRun: boolean
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, details: [] };

  if (!responseData.success || !responseData.data) {
    logger.warn("T631 dispatch group search returned unsuccessful or empty data", {
      service: "t631-sync-job-groups",
      success: responseData.success,
    });
    return result;
  }

  const remoteGroups = responseData.data;
  const remoteEntries = Object.values(remoteGroups);

  if (remoteEntries.length === 0) {
    logger.info("No remote groups to sync", { service: "t631-sync-job-groups" });
    return result;
  }

  for (const remote of remoteEntries) {
    const name = remote.title;
    if (!name) {
      result.skipped++;
      result.details.push({ name: "(empty title)", action: "skipped", error: "Missing title" });
      continue;
    }

    const siriusId = extractSiriusId(remote);
    if (!siriusId) {
      result.skipped++;
      result.details.push({ name, action: "skipped", error: "Missing UUID/nid" });
      continue;
    }

    const startYmd = extractYmd(remote.field_sirius_datetime);
    const endYmd = extractYmd(remote.field_sirius_datetime_completed);

    if (!startYmd || !endYmd) {
      result.skipped++;
      result.details.push({ name, action: "skipped", error: `Missing dates: start=${startYmd}, end=${endYmd}` });
      continue;
    }

    const t631Data = { ...remote };

    let existing = await storage.dispatchJobGroups.getBySiriusId(siriusId);

    if (!existing) {
      const byName = await storage.dispatchJobGroups.getByName(name);
      if (byName && !byName.siriusId) {
        existing = byName;
        logger.info(`Linked existing job group "${name}" to siriusId ${siriusId} (name-based fallback)`, {
          service: "t631-sync-job-groups",
          groupId: byName.id,
          siriusId,
        });
      }
    }

    try {
      if (existing) {
        const newDataStr = stableStringify(t631Data);
        const existingDataStr = stableStringify(existing.data);
        const needsSiriusId = existing.siriusId !== siriusId;
        const hasChanges =
          existing.name !== name ||
          existing.startYmd !== startYmd ||
          existing.endYmd !== endYmd ||
          existingDataStr !== newDataStr ||
          needsSiriusId;

        if (!hasChanges) {
          result.unchanged++;
          result.details.push({ name, action: dryRun ? "would_be_unchanged" : "unchanged" });
        } else if (dryRun) {
          result.updated++;
          result.details.push({ name, action: "would_update" });
        } else {
          await storage.dispatchJobGroups.update(existing.id, {
            name,
            startYmd,
            endYmd,
            siriusId,
            data: t631Data as Record<string, unknown>,
          });
          result.updated++;
          result.details.push({ name, action: "updated" });
        }
      } else {
        if (dryRun) {
          result.created++;
          result.details.push({ name, action: "would_create" });
        } else {
          const insert: InsertDispatchJobGroup = {
            name,
            startYmd,
            endYmd,
            siriusId,
            data: t631Data as Record<string, unknown>,
          };
          await storage.dispatchJobGroups.create(insert);
          result.created++;
          result.details.push({ name, action: "created" });
        }
      }
    } catch (error) {
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ name, action: "error", error: errMsg });
      logger.error(`Failed to sync T631 job group "${name}"`, {
        service: "t631-sync-job-groups",
        error: errMsg,
      });
    }
  }

  return result;
}

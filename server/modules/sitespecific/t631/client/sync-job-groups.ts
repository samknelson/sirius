import { storage } from "../../../../storage";
import { logger } from "../../../../logger";
import type { DispatchJobGroup, InsertDispatchJobGroup } from "@shared/schema";

interface T631GroupRecord {
  nid: string;
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

export async function syncT631JobGroups(
  responseData: T631GroupSearchResponse,
  dryRun: boolean
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0, details: [] };

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

  const existingGroups = await storage.dispatchJobGroups.getAll();
  const existingByName = new Map<string, DispatchJobGroup>();
  for (const g of existingGroups) {
    existingByName.set(g.name.toLowerCase(), g);
  }

  for (const remote of remoteEntries) {
    const name = remote.title;
    if (!name) {
      result.skipped++;
      result.details.push({ name: "(empty title)", action: "skipped", error: "Missing title" });
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

    const existing = existingByName.get(name.toLowerCase());

    try {
      if (existing) {
        if (dryRun) {
          result.updated++;
          result.details.push({ name, action: "would_update" });
        } else {
          await storage.dispatchJobGroups.update(existing.id, {
            name,
            startYmd,
            endYmd,
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

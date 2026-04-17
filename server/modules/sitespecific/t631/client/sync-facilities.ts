import { storage } from "../../../../storage";
import { logger } from "../../../../logger";

interface T631FacilityDropdownResponse {
  success: boolean;
  data?: Record<string, string>;
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

export async function syncFacilities(
  responseData: T631FacilityDropdownResponse,
  dryRun: boolean,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, details: [] };

  if (!responseData.success || !responseData.data) {
    logger.warn("T631 facility dropdown returned unsuccessful or empty data", {
      service: "t631-sync-facilities",
      success: responseData.success,
    });
    return result;
  }

  const remoteEntries = Object.entries(responseData.data);

  if (remoteEntries.length === 0) {
    logger.info("No remote facilities to sync", { service: "t631-sync-facilities" });
    return result;
  }

  for (const [rawSiriusId, rawName] of remoteEntries) {
    const siriusId = (rawSiriusId ?? "").toString().trim();
    const name = typeof rawName === "string" ? rawName.trim() : "";

    if (!siriusId) {
      result.skipped++;
      result.details.push({ name: name || "(empty)", action: "skipped", error: "Missing siriusId" });
      continue;
    }
    if (!name) {
      result.skipped++;
      result.details.push({ name: `siriusId=${siriusId}`, action: "skipped", error: "Missing name" });
      continue;
    }

    try {
      const existing = await storage.facilities.getBySiriusId(siriusId);

      if (existing) {
        if (existing.name === name) {
          result.unchanged++;
          result.details.push({ name, action: dryRun ? "would_be_unchanged" : "unchanged" });
        } else if (dryRun) {
          result.updated++;
          result.details.push({ name, action: "would_update" });
        } else {
          await storage.facilities.updateContactName(existing.id, name);
          result.updated++;
          result.details.push({ name, action: "updated" });
        }
      } else {
        if (dryRun) {
          result.created++;
          result.details.push({ name, action: "would_create" });
        } else {
          await storage.facilities.create({ name, siriusId });
          result.created++;
          result.details.push({ name, action: "created" });
        }
      }
    } catch (error) {
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ name, action: "error", error: errMsg });
      logger.error(`Failed to sync T631 facility "${name}" (siriusId=${siriusId})`, {
        service: "t631-sync-facilities",
        error: errMsg,
      });
    }
  }

  return result;
}

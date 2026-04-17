import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { t631Fetch } from "../../modules/sitespecific/t631/client/fetch";
import { syncFacilities } from "../../modules/sitespecific/t631/client/sync-facilities";

export const t631FacilityFetchHandler: CronJobHandler = {
  description: "Fetches the facility dropdown from the T631 server and syncs facilities into the local database",
  requiresComponent: "sitespecific.t631.client",

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const isDryRun = context.mode === "test";

    const fetchResult = await t631Fetch("sirius_dispatch_facility_dropdown");

    if (!fetchResult.success) {
      throw new Error(`T631 fetch failed: ${fetchResult.error || "Unknown error"}`);
    }

    const responseBody = fetchResult.data;
    if (!responseBody || typeof responseBody !== "object") {
      throw new Error("T631 fetch returned empty or non-object response body");
    }

    const typed = responseBody as { success?: boolean; data?: Record<string, unknown> };
    if (!typed.success) {
      throw new Error("T631 response indicates failure (success !== true)");
    }
    if (!typed.data || typeof typed.data !== "object") {
      throw new Error("T631 response missing 'data' field or data is not an object");
    }

    const syncResult = await syncFacilities(
      responseBody as Parameters<typeof syncFacilities>[0],
      isDryRun,
    );

    const prefix = isDryRun ? "[TEST] " : "";
    const message = `${prefix}Synced T631 facilities: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.unchanged} unchanged, ${syncResult.skipped} skipped, ${syncResult.errors} errors`;

    return {
      message,
      metadata: {
        created: syncResult.created,
        updated: syncResult.updated,
        unchanged: syncResult.unchanged,
        skipped: syncResult.skipped,
        errors: syncResult.errors,
        details: syncResult.details,
      },
    };
  },
};

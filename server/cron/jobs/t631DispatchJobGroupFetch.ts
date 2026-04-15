import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { t631Fetch } from "../../modules/sitespecific/t631/client/fetch";
import { syncT631JobGroups } from "../../modules/sitespecific/t631/client/sync-job-groups";

export const t631DispatchJobGroupFetchHandler: CronJobHandler = {
  description: "Fetches dispatch job groups from the T631 server and syncs them into the local database",
  requiresComponent: "sitespecific.t631.client",

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const isDryRun = context.mode === "test";

    const fetchResult = await t631Fetch("sirius_dispatch_group_search");

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

    const syncResult = await syncT631JobGroups(
      responseBody as Parameters<typeof syncT631JobGroups>[0],
      isDryRun
    );

    const prefix = isDryRun ? "[TEST] " : "";
    const message = `${prefix}Synced T631 dispatch job groups: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.skipped} skipped, ${syncResult.errors} errors`;

    return {
      message,
      metadata: {
        created: syncResult.created,
        updated: syncResult.updated,
        skipped: syncResult.skipped,
        errors: syncResult.errors,
        details: syncResult.details,
      },
    };
  },
};

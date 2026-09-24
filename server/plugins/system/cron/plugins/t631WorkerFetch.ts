import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { t631Fetch } from "../../../../modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../../../modules/sitespecific/t631/client/sync-workers";

registerCronPlugin({
  metadata: {
    id: 'sitespecific-t631-worker-fetch',
    name: 'T631 Worker EIN Fetch',
    description: 'Fetches the worker list from the T631 server and syncs each worker\'s EIN into the freeman_ein worker ID type',
    requiredComponent: 'sitespecific.t631.client',
    singleton: true,
  },
  defaultSchedule: '0 9 * * *', // Daily at 9 AM
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const isDryRun = context.mode === "test";

    const fetchResult = await t631Fetch("sirius_edls_server_worker_list");

    if (!fetchResult.success) {
      throw new Error(`T631 fetch failed: ${fetchResult.error || "Unknown error"}`);
    }

    const responseBody = fetchResult.data;
    if (!responseBody || typeof responseBody !== "object") {
      throw new Error("T631 fetch returned empty or non-object response body");
    }

    const typed = responseBody as { success?: boolean; data?: { workers?: unknown } };
    if (!typed.success) {
      throw new Error("T631 response indicates failure (success !== true)");
    }
    if (!typed.data || typeof typed.data !== "object") {
      throw new Error("T631 response missing 'data' field or data is not an object");
    }
    if (typed.data.workers === undefined || typed.data.workers === null || typeof typed.data.workers !== "object") {
      throw new Error("T631 response missing 'data.workers' field or it is not an array/object");
    }

    const syncResult = await syncWorkerEins(
      responseBody as Parameters<typeof syncWorkerEins>[0],
      isDryRun,
    );

    const prefix = isDryRun ? "[TEST] " : "";
    const message =
      `${prefix}Synced T631 worker EINs: ${syncResult.created} created, ${syncResult.updated} updated, ` +
      `${syncResult.unchanged} unchanged, ${syncResult.skipped} skipped, ${syncResult.errors} errors`;

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
});

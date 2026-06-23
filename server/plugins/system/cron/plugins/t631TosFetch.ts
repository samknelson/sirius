import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { t631Fetch } from "../../../../modules/sitespecific/t631/client/fetch";
import { syncTos } from "../../../../modules/sitespecific/t631/client/sync-tos";

registerCronPlugin({
  metadata: {
    id: 'sitespecific-t631-tos-fetch',
    name: 'T631 TOS Fetch',
    description: 'Fetches active Time Off Sick records from the T631 server and syncs them into the local worker_tos table',
    requiredComponent: 'sitespecific.t631.client',
    singleton: true,
  },
  defaultSchedule: '0 10 * * *', // Daily at 10 AM
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const isDryRun = context.mode === "test";

    const fetchResult = await t631Fetch("sirius_edls_server_tos_list");

    if (!fetchResult.success) {
      throw new Error(`T631 fetch failed: ${fetchResult.error || "Unknown error"}`);
    }

    const responseBody = fetchResult.data;
    if (!responseBody || typeof responseBody !== "object") {
      throw new Error("T631 fetch returned empty or non-object response body");
    }

    const typed = responseBody as { success?: boolean; data?: { tos_nodes?: Record<string, unknown> } };
    if (!typed.success) {
      throw new Error("T631 response indicates failure (success !== true)");
    }
    if (!typed.data || typeof typed.data !== "object") {
      throw new Error("T631 response missing 'data' field or data is not an object");
    }
    if (!typed.data.tos_nodes || typeof typed.data.tos_nodes !== "object" || Array.isArray(typed.data.tos_nodes)) {
      throw new Error("T631 response missing 'data.tos_nodes' field or it is not an object");
    }

    const syncResult = await syncTos(
      responseBody as Parameters<typeof syncTos>[0],
      isDryRun,
    );

    const prefix = isDryRun ? "[TEST] " : "";
    const message =
      `${prefix}Synced T631 TOS: ${syncResult.created} created, ${syncResult.reopened} reopened, ` +
      `${syncResult.updated} updated, ${syncResult.unchanged} unchanged, ${syncResult.terminated} terminated, ` +
      `${syncResult.skipped} skipped, ${syncResult.errors} errors`;

    return {
      message,
      metadata: {
        created: syncResult.created,
        reopened: syncResult.reopened,
        updated: syncResult.updated,
        unchanged: syncResult.unchanged,
        terminated: syncResult.terminated,
        skipped: syncResult.skipped,
        errors: syncResult.errors,
        details: syncResult.details,
      },
    };
  },
});

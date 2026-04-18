import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { t631Fetch } from "../../modules/sitespecific/t631/client/fetch";
import { syncTos } from "../../modules/sitespecific/t631/client/sync-tos";

export const t631TosFetchHandler: CronJobHandler = {
  description: "Fetches active Time Off Sick records from the T631 server and syncs them into the local worker_tos table",
  requiresComponent: "sitespecific.t631.client",

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
};

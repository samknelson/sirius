import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { startT631Run } from "../../../../services/t631-sync-runs";
import type { WorkerEinSyncResult } from "../../../../modules/sitespecific/t631/client/sync-workers";

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

    const { run, duplicate } = await startT631Run(isDryRun, context.triggeredBy ?? "scheduler", true);
    if (duplicate) return { message: "Skipped: a T631 worker sync is already active.", metadata: { runId: run.id } };
    if (run.status !== "success") throw new Error(run.error ?? "T631 sync did not complete.");
    const syncResult = JSON.parse(run.output!) as WorkerEinSyncResult;

    const prefix = isDryRun ? "[TEST] " : "";
    const message =
      `${prefix}Synced T631 worker EINs: ${syncResult.created} created, ${syncResult.updated} updated, ` +
      `${syncResult.deleted} deleted, ${syncResult.unchanged} unchanged, ${syncResult.skipped} skipped, ${syncResult.errors} errors`;

    return {
      message,
      metadata: {
        created: syncResult.created,
        updated: syncResult.updated,
        deleted: syncResult.deleted,
        unchanged: syncResult.unchanged,
        skipped: syncResult.skipped,
        errors: syncResult.errors,
        details: syncResult.details,
      },
    };
  },
});

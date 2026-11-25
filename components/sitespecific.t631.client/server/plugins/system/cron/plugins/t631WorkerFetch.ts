import { registerCronPlugin } from "../../../../../../../server/plugins/system/cron/registry";
import type { CronJobContext, CronJobResult } from "../../../../../../../server/plugins/system/cron/types";
import { executeT631WorkerSync } from "../../../../services/t631-worker-sync";

registerCronPlugin({
  metadata: {
    id: 'sitespecific-t631-worker-fetch',
    name: 'T631 Worker EIN Fetch',
    description: 'Fetches the worker list from the T631 server and syncs workers through the installed identity provider',
    requiredComponent: 'sitespecific.t631.client',
    singleton: true,
  },
  defaultSchedule: '0 9 * * *', // Daily at 9 AM
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const isDryRun = context.mode === "test";

    const syncResult = await executeT631WorkerSync(context);

    const prefix = isDryRun ? "[TEST] " : "";
    const message =
      `${prefix}Synced T631 worker EINs: ${syncResult.created} created, ${syncResult.updated} updated, ` +
      `${syncResult.deleted} deleted, ${syncResult.unchanged} unchanged, ${syncResult.skipped} skipped, ${syncResult.errors} errors`;

    return {
      message,
      metadata: {
        dryRun: isDryRun,
        ...syncResult,
      },
    };
  },
});

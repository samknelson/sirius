import { z } from "zod";
import { reconcileVariableContributionForAllWorkers } from "../../../../services/sitespecific/gbhet/pension-sla";
import { storage } from "../../../../storage";
import { pickFirstByAccountOrder, toChargeConfig } from "../../../ledger/charge/charge-config-resolution";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

const settingsSchema = z.object({});

const VAR_CONTRIB_PLUGIN_ID = "gbhet-pension-variable-contribution";

async function resolveConfigId(): Promise<string> {
  const globalConfig = pickFirstByAccountOrder(
    (await storage.pluginConfigs.search("charge", {
      pluginId: VAR_CONTRIB_PLUGIN_ID,
      scope: "global",
      employerId: null,
    })).map(toChargeConfig),
  );
  if (globalConfig?.id) return globalConfig.id;
  const batchConfig = pickFirstByAccountOrder(
    (await storage.pluginConfigs.search("charge", {
      pluginId: VAR_CONTRIB_PLUGIN_ID,
      scope: "batch",
      employerId: null,
    })).map(toChargeConfig),
  );
  if (batchConfig?.id) return batchConfig.id;
  return "batch";
}

registerCronPlugin({
  metadata: {
    id: 'gbhet-pension-shares-reconcile',
    name: 'GBHET Pension Shares Reconcile',
    description: 'Reconciles GBHET VDB pension share-based variable contribution ledger entries for all workers (replaces former cascade plugin)',
    requiredComponent: 'sitespecific.gbhet.pension',
    singleton: true,
  },
  defaultSchedule: '45 2 * * *', // Daily at 2:45 AM
  defaultEnabled: false,

  settingsSchema,

  getDefaultSettings: () => ({}),

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const configId = await resolveConfigId();

    if (context.mode === "test") {
      return {
        message: `Would reconcile VDB shares for all workers (configId=${configId})`,
        metadata: { configId, dryRun: true },
      };
    }

    const result = await reconcileVariableContributionForAllWorkers();

    return {
      message: `VDB shares reconciled: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors, ${result.orphansDeleted ?? 0} orphans deleted`,
      metadata: {
        configId,
        processed: result.processed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        orphansDeleted: result.orphansDeleted ?? 0,
        knownKeyCount: result.producedKeys?.length ?? 0,
        ...(result.errorDetails.length > 0 ? { errorDetails: result.errorDetails.slice(0, 10) } : {}),
      },
    };
  },
});

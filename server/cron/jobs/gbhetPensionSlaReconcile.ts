import { z } from "zod";
import { reconcileContributionPctYears } from "../../services/sitespecific/gbhet/pension-sla";
import { storage } from "../../storage";
import { pickFirstByAccountOrder, toChargeConfig } from "../../plugins/ledger/charge/charge-config-resolution";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

const settingsSchema = z.object({});

const CONTRIBUTION_PLUGIN_ID = "gbhet-pension-sla-contribution";

async function resolveConfigId(): Promise<string> {
  const globalConfig = pickFirstByAccountOrder(
    (await storage.pluginConfigs.search("charge", {
      pluginId: CONTRIBUTION_PLUGIN_ID,
      scope: "global",
      employerId: null,
    })).map(toChargeConfig),
  );
  if (globalConfig?.id) return globalConfig.id;
  const batchConfig = pickFirstByAccountOrder(
    (await storage.pluginConfigs.search("charge", {
      pluginId: CONTRIBUTION_PLUGIN_ID,
      scope: "batch",
      employerId: null,
    })).map(toChargeConfig),
  );
  if (batchConfig?.id) return batchConfig.id;
  return "batch";
}

export const gbhetPensionSlaReconcileHandler: CronJobHandler = {
  description: "Reconciles VDB SLA contribution-percent ledger entries against trigger entries (replaces ledger-cascade plugin)",
  requiresComponent: "sitespecific.gbhet.pension",

  settingsSchema,

  getDefaultSettings: () => ({}),

  async execute(context: CronJobContext): Promise<CronJobResult> {
    if (context.mode === "test") {
      const configId = await resolveConfigId();
      return {
        message: `Would reconcile VDB SLA contribution entries (configId=${configId})`,
        metadata: { configId, dryRun: true },
      };
    }

    const configId = await resolveConfigId();
    const result = await reconcileContributionPctYears(configId);

    return {
      message: `SLA contribution reconciled: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors, ${result.orphansDeleted ?? 0} orphans deleted`,
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
};

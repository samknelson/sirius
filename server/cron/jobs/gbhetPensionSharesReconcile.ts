import { z } from "zod";
import { reconcileVariableContributionForAllWorkers } from "../../services/gbhet-pension-sla";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

const settingsSchema = z.object({});

export const gbhetPensionSharesReconcileHandler: CronJobHandler = {
  description: "Reconciles VDB share-based variable contribution ledger entries from per-worker SLA totals (replaces ledger-cascade plugin)",
  requiresComponent: "sitespecific.gbhet.pension",

  settingsSchema,

  getDefaultSettings: () => ({}),

  async execute(context: CronJobContext): Promise<CronJobResult> {
    if (context.mode === "test") {
      return {
        message: "Would reconcile VDB shares for all workers",
        metadata: { dryRun: true },
      };
    }

    const result = await reconcileVariableContributionForAllWorkers();

    return {
      message: `VDB shares reconciled: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors, ${result.orphansDeleted ?? 0} orphans deleted`,
      metadata: {
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

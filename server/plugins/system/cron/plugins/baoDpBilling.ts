import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { executeChargePlugins, TriggerType } from "../../../ledger/charge";

const DP_CHARGE_PLUGIN_ID = "sitespecific-bao-dp";

/**
 * BAO Domestic Partner monthly billing cron.
 *
 * Runs ONLY the BAO DP monthly member charge plugin (every enabled config
 * of it): one ledger charge per (DP dependent, coverage month) of each
 * active election covering a DP, at most one coverage month in advance,
 * plus offsetting adjustments for (DP, month)s that fell out of coverage
 * (ended elections, removed DPs, lost subscriber coverage). The charge
 * plugin owns all idempotency — re-running this job never double-charges or
 * double-reverses. The run summary surfaces skipped months (missing or
 * provisional rates, missing subscriber coverage).
 *
 * Disabled by default and gated on the `sitespecific.bao` component. Test
 * mode is passed through: the charge plugin reports what it would do
 * without posting entries.
 */
registerCronPlugin({
  metadata: {
    id: "bao-dp-billing",
    name: "BAO - Domestic Partner Monthly Billing",
    description:
      "Bills Domestic Partner monthly member charges (the collected amount from the DP rate sheet) for active elections that cover a DP dependent (one ledger charge per DP per coverage month, priced from the DP rate sheet by coverage-tier transition, at most one month in advance, only for months the subscriber has a benefit) and posts offsetting adjustments for months no longer covered. Skipped months (missing/provisional rates, missing subscriber coverage) and confirmed no-charge months are surfaced in the run summary.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "30 4 * * *", // Daily at 4:30 AM, after COBRA billing
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const result = await executeChargePlugins(
      {
        trigger: TriggerType.CRON,
        jobId: context.jobId,
        mode: context.mode,
      },
      { onlyPluginIds: [DP_CHARGE_PLUGIN_ID] },
    );

    const failures = result.executed.filter((e) => !e.success);
    const prefix = context.mode === "test" ? "[TEST] " : "";
    const detail = result.executed.map((e) => e.message).filter(Boolean).join("; ");
    const message = `${prefix}Ran ${result.executed.length} DP billing config(s): ${result.totalTransactions.length} entries posted${detail ? ` — ${detail}` : ""}${failures.length ? `, ${failures.length} failed` : ""}`;

    if (failures.length > 0) {
      throw new Error(
        `${message} — ${failures.map((f) => `${f.pluginId}: ${f.error}`).join("; ")}`,
      );
    }

    return {
      message,
      metadata: {
        configsRun: result.executed.length,
        entriesPosted: result.totalTransactions.length,
        plugins: result.executed.map((e) => ({
          pluginId: e.pluginId,
          success: e.success,
          transactionCount: e.transactionCount,
          message: e.message,
        })),
      },
    };
  },
});

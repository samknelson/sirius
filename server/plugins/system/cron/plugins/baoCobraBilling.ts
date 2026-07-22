import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { executeChargePlugins, TriggerType } from "../../../ledger/charge";

const COBRA_CHARGE_PLUGIN_ID = "sitespecific-bao-cobra";

/**
 * BAO COBRA monthly billing cron.
 *
 * Runs ONLY the BAO COBRA monthly premium charge plugin (every enabled config
 * of it): one ledger charge per covered month of each elected COBRA case,
 * plus offsetting adjustments for months that fell out of coverage (canceled
 * elections / shortened end dates). The charge plugin owns all idempotency —
 * re-running this job never double-charges or double-reverses.
 *
 * Disabled by default and gated on the `sitespecific.bao` component. Test
 * mode is passed through: the charge plugin reports what it would do without
 * posting entries.
 */
registerCronPlugin({
  metadata: {
    id: "bao-cobra-billing",
    name: "BAO - COBRA Monthly Billing",
    description:
      "Bills COBRA monthly premiums for elected COBRA cases (one ledger charge per covered month, priced from the COBRA rate table plus the 2% administration fee) and posts offsetting adjustments for months no longer covered.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "0 4 * * *", // Daily at 4 AM, before the status scan
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const result = await executeChargePlugins(
      {
        trigger: TriggerType.CRON,
        jobId: context.jobId,
        mode: context.mode,
      },
      { onlyPluginIds: [COBRA_CHARGE_PLUGIN_ID] },
    );

    const failures = result.executed.filter((e) => !e.success);
    const prefix = context.mode === "test" ? "[TEST] " : "";
    const detail = result.executed.map((e) => e.message).filter(Boolean).join("; ");
    const message = `${prefix}Ran ${result.executed.length} COBRA billing config(s): ${result.totalTransactions.length} entries posted${detail ? ` — ${detail}` : ""}${failures.length ? `, ${failures.length} failed` : ""}`;

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

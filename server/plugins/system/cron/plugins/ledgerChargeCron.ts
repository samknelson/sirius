import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { executeChargePlugins, TriggerType } from "../../../ledger/charge";

/**
 * Runs every charge plugin registered for the CRON trigger (e.g. the COBRA
 * monthly premium plugin). Each such plugin is responsible for its own
 * idempotency — this job just gives them a scheduled heartbeat.
 *
 * Test mode is passed through: CRON-triggered charge plugins receive
 * `mode: "test"` and must not post entries in that mode.
 */
registerCronPlugin({
  metadata: {
    id: "ledger-charge-cron",
    name: "Ledger Scheduled Charges",
    description:
      "Runs all ledger charge plugins that bill on a schedule (CRON trigger), such as COBRA monthly premiums.",
    requiredComponent: "ledger",
    singleton: true,
  },
  defaultSchedule: "0 4 * * *", // Daily at 4 AM
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const result = await executeChargePlugins({
      trigger: TriggerType.CRON,
      jobId: context.jobId,
      mode: context.mode,
    });

    const failures = result.executed.filter((e) => !e.success);
    const prefix = context.mode === "test" ? "[TEST] " : "";
    const message = `${prefix}Ran ${result.executed.length} scheduled charge plugin config(s): ${result.totalTransactions.length} entries created${failures.length ? `, ${failures.length} failed` : ""}`;

    if (failures.length > 0) {
      throw new Error(
        `${message} — ${failures.map((f) => `${f.pluginId}: ${f.error}`).join("; ")}`,
      );
    }

    return {
      message,
      metadata: {
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

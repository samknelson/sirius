import { scanBaoMemberStatuses } from "../../../../services/bao-member-status-scan";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * BAO member status scan: automatically assigns hours-based member statuses
 * (Event Center 100-hour at first Event Center hours, upgrade to 80-hour at
 * the 5-year anniversary while still employed, UNITE HERE 60-hour at first
 * Hospitality hours) while never touching manually-managed statuses
 * (grandfathered Event Center 60-hour, PA Worker, UNITE HERE 40-hour).
 * See `services/bao-member-status-scan.ts` for the full algorithm.
 */
registerCronPlugin({
  metadata: {
    id: "bao-member-status-scan",
    name: "BAO Member Status Scan",
    description:
      "Assigns hours-based member statuses for BAO workers: Event Center 100-hour at first Event Center hours, 80-hour upgrade at the 5-year anniversary while still employed, UNITE HERE 60-hour at first Hospitality hours. Never touches manually-managed statuses.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "0 6 * * *", // Daily at 6 AM
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const result = await scanBaoMemberStatuses(context.mode);

    const summary =
      `${result.workersScanned} workers scanned: ` +
      `${result.ec100Set} EC 100-hour set, ${result.ec80Upgraded} EC 80-hour upgrades, ` +
      `${result.h60Set} UNITE HERE 60-hour set, ${result.skippedManual} skipped (manual status), ` +
      `${result.errors} errors`;

    return {
      message: context.mode === "live" ? summary : `Would apply — ${summary}`,
      metadata: {
        workersScanned: result.workersScanned,
        ec100Set: result.ec100Set,
        ec80Upgraded: result.ec80Upgraded,
        h60Set: result.h60Set,
        skippedManual: result.skippedManual,
        alreadyCurrent: result.alreadyCurrent,
        errors: result.errors,
        ...(context.mode === "test" ? { pending: result.pending.slice(0, 100) } : {}),
      },
    };
  },
});

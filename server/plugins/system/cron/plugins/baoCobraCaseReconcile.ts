import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { storage } from "../../../../storage/database";
import { reconcileCobraCases } from "../../../../services/bao-cobra-case-reconcile";

/**
 * Nightly COBRA case reconciliation.
 *
 * Self-healing pass over the persisted WMB terminate events
 * (`trust_wmb_events`): any medical/dental termination month that never got
 * its initial COBRA case (missed live event, scan replay, backfill) gets one
 * created — ONE case per covered person per month, medical + dental
 * combined. Existing cases (open or closed) for the same person and month
 * are never duplicated; open un-elected cases missing a benefit are merged.
 *
 * Test mode reports what would change without writing.
 */
registerCronPlugin({
  metadata: {
    id: "bao-cobra-case-reconcile",
    name: "BAO - COBRA Case Reconciliation",
    description:
      "Creates missing initial COBRA cases from persisted WMB terminate events (one case per worker per month, medical + dental combined). Idempotent.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "45 4 * * *", // Daily at 4:45 AM, after the WMB/denorm crons
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    if (!(await storage.baoCobraCases.tableExists())) {
      return { message: "COBRA tables are not provisioned; nothing to reconcile" };
    }

    const summary = await reconcileCobraCases({ dryRun: context.mode !== "live" });

    const verb = context.mode === "live" ? "Reconciled" : "[TEST] Would reconcile";
    return {
      message:
        `${verb} ${summary.groups} termination group(s) from ${summary.events} terminate event(s): ` +
        `${summary.created} case(s) created, ${summary.merged} merged, ` +
        `${summary.skippedExisting} already handled, ${summary.skippedInvariant} blocked by invariants, ` +
        `${summary.notQualifying} not qualifying` +
        (summary.errors ? `, ${summary.errors} error(s)` : ""),
      metadata: { ...summary },
    };
  },
});

import { scanAllWorkers } from "../../services/member-status-scan";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

export const memberStatusScanHandler: CronJobHandler = {
  description: 'Scans all active workers and updates their member status based on card check and dues payment history',

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const result = await scanAllWorkers(context.mode);

    return {
      message: context.mode === 'live'
        ? `Scanned ${result.totalScanned} workers: ${result.changed} updated, ${result.unchanged} unchanged, ${result.errors} errors`
        : `Would update ${result.changed} of ${result.totalScanned} workers (${result.unchanged} unchanged, ${result.errors} errors)`,
      metadata: {
        totalScanned: result.totalScanned,
        changed: result.changed,
        unchanged: result.unchanged,
        errors: result.errors,
        toMember: result.details.toMember,
        toPending: result.details.toPending,
        toDelinquent: result.details.toDelinquent,
        toNonMember: result.details.toNonMember,
      },
    };
  },
};

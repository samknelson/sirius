import type { CronJobContext } from "../../../../server/plugins/system/cron/types";
import { requestContext } from "../../../../server/middleware/request-context";
import { runInTransaction, runOutsideTransaction, TransactionInterrupted } from "../../../../server/storage/transaction-context";
import { SemaphoreLost } from "../../../../server/storage/system/semaphores";
import { assertExternalServiceAllowed, isMaintenanceModeError } from "../../../../server/services/maintenance-flag";
import { isComponentEnabled } from "../../../../server/modules/components";
import { isT631ConfigurationError, t631Fetch } from "../modules/sitespecific/t631/client/fetch";
import { SyncInterrupted, SyncRunRefusal, syncWorkerEins, type SyncUnit } from "../../../../server/services/worker-sync";
import { logger } from "../../../../server/logger";

// Business limits, not coordination's five-second deadline or maintenance override.
const WORKER_LIMITS = {
  statementMs: 60_000,
  idleMs: 15_000,
  applicationName: "t631:worker-unit",
};
class RemoteFailure extends Error {}

export function validateT631Workers(value: unknown): asserts value is Parameters<typeof syncWorkerEins>[0] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RemoteFailure();
  const body = value as { success?: unknown; data?: { workers?: unknown } };
  if (body.success !== true || !body.data || typeof body.data !== "object") throw new RemoteFailure();
  const workers = body.data.workers;
  if (!workers || typeof workers !== "object" ||
      Object.values(workers).some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new RemoteFailure();
  }
}

async function checkEnabled() {
  assertExternalServiceAllowed("T631", "sync workers");
  if (!await isComponentEnabled("edls") || !await isComponentEnabled("sitespecific.t631.client")) {
    throw new SyncRunRefusal("T631 sync requires both EDLS and the T631 client component.");
  }
}

/** No launcher, history or acquisition here: cron owns this entire execution. */
export async function executeT631WorkerSync(context: CronJobContext) {
  const owner = context.execution;
  // Refuse unguarded callers rather than silently falling back to unsafe writes.
  if (!owner) throw new Error("T631 worker sync requires cron execution authority.");
  const unit: SyncUnit = async work => {
    try {
      owner.assertOwned();
      await runOutsideTransaction(() => runInTransaction(() =>
        owner.inTransaction(async () => {
          await checkEnabled();
          await work();
        }), WORKER_LIMITS));
    } catch (error) {
      // Reconciliation catches ordinary worker errors. These must stop the
      // whole import, including its missing-worker deactivation pass.
      if (error instanceof SemaphoreLost || error instanceof TransactionInterrupted) throw new SyncInterrupted();
      throw error;
    }
  };
  const actorContext = {
    ...requestContext.getStore(),
    userId: context.triggeredBy && context.triggeredBy !== "scheduler" ? context.triggeredBy : undefined,
  };
  return requestContext.run(actorContext, () => runOutsideTransaction(async () => {
    try {
      await checkEnabled();
      owner.assertOwned();
      const fetchStart = performance.now();
      const remote = await t631Fetch("sitespecific.t631.worker.list");
      const fetchMs = performance.now() - fetchStart;
      owner.assertOwned();
      if (!remote.success) throw new RemoteFailure();
      validateT631Workers(remote.data);
      const reconcileStart = performance.now();
      const result = await syncWorkerEins(remote.data, context.mode === "test", unit);
      owner.assertOwned();
      logger.info("T631 sync phase timings", {
        service: "t631-sync-workers", dryRun: context.mode === "test", fetchMs,
        remoteTimings: remote.timings, reconciliationMs: performance.now() - reconcileStart,
        rowCounts: result.rowCounts, skipped: result.skipped, errors: result.errors,
        edlsDeactivated: result.edlsDeactivated,
      });
      return result;
    } catch (error) {
      if (error instanceof SemaphoreLost) throw error;
      if (error instanceof SyncInterrupted || error instanceof TransactionInterrupted) throw new SemaphoreLost();
      // Do not copy credentials or arbitrary remote replies into cron history.
      const message = isMaintenanceModeError(error)
        ? "Maintenance refusal: sync stopped because the site is in maintenance mode."
        : isT631ConfigurationError(error) || error instanceof SyncRunRefusal
          ? "Configuration refusal: check the T631 connection, credentials, and enabled components."
          : error instanceof RemoteFailure
            ? "Remote failure: T631 timed out, could not be reached, or returned an invalid/unsuccessful worker response."
            : "Sync failed. Partial live changes may remain; review before starting another run.";
      throw new Error(message);
    }
  }));
}

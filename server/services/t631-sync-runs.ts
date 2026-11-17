import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { jobRuns, type JobRun } from "@shared/schema";
import { db } from "../storage/db";
import { getClient, runInTransaction, runOutsideTransaction } from "../storage/transaction-context";
import { requestContext } from "../middleware/request-context";
import { assertExternalServiceAllowed, isMaintenanceModeError } from "./maintenance-flag";
import { isComponentEnabled } from "../modules/components";
import { isT631ConfigurationError, t631Fetch } from "../modules/sitespecific/t631/client/fetch";
import { SyncInterrupted, SyncRunRefusal, syncWorkerEins, type SyncUnit } from "../modules/sitespecific/t631/client/sync-workers";
import { ResourceLease } from "./resource-lease";
import { SemaphoreLost } from "../storage/system/semaphores";
import { logger } from "../logger";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";

const KIND = "t631-sync";
const PLUGIN = "sitespecific-t631-worker-fetch";
// Shared across every configuration, manual/cron caller, and test/live mode.
export const T631_RESOURCE = "t631:sync-workers";
// Retained transaction fence; no session-level ownership connection.
const FENCE = 2032002;
const scope = and(eq(jobRuns.pluginKind, KIND), eq(jobRuns.pluginId, PLUGIN));
const running = and(scope, eq(jobRuns.status, "running"));
const interruptedMessage = "Sync interrupted. Partial live changes may remain. Review before starting another run; nothing is automatically replayed.";

export class T631RunRefusal extends SyncRunRefusal {
  constructor(public status: number, message: string) { super(message); }
}
class RemoteFailure extends Error {}

export function publicT631Run(run: JobRun) {
  return {
    id: run.id, status: run.status, dryRun: run.mode === "test",
    startedAt: run.startedAt, completedAt: run.completedAt, heartbeatAt: run.heartbeatAt,
    triggeredBy: run.triggeredBy, error: run.error,
    result: run.status === "success" && run.output ? JSON.parse(run.output) : null,
  };
}

async function fence(client: Pick<ReturnType<typeof getClient>, "execute"> = getClient()) {
  const locked = await client.execute(sql`SELECT pg_try_advisory_xact_lock(${FENCE}) AS acquired`);
  if (!locked.rows[0]?.acquired) {
    throw new T631RunRefusal(409, "An interrupted sync is finishing its current worker. Check status before trying again.");
  }
}

// History only: the shared bounded coordination transaction, never worker work.
function history<T>(owner: ResourceLease, work: (client: ReturnType<typeof drizzle>) => Promise<T>) {
  return owner.whileOwned(async (client: PoolClient) => {
    const tx = drizzle(client);
    await fence(tx);
    return work(tx);
  });
}

async function recoverAbandoned(owner: ResourceLease, create?: { dryRun: boolean; actorId: string }) {
  // Heartbeats are never takeover authority. Admission and recovery share the
  // worker's transaction fence AND a current, row-locked database lease.
  return history(owner, async client => {
    await client.update(jobRuns).set({
      status: "interrupted", error: interruptedMessage, completedAt: new Date(),
    }).where(running);
    if (!create) return { acquired: true as const };
    // Recovery and insertion are ONE fenced commit.
    await checkEnabled();
    const [run] = await client.insert(jobRuns).values({
      pluginKind: KIND, pluginId: PLUGIN, operation: "sync-workers",
      status: "running", mode: create.dryRun ? "test" : "live",
      triggeredBy: create.actorId, heartbeatAt: new Date(),
    }).returning();
    return { acquired: true as const, run };
  });
}

export async function readT631Run(id?: string): Promise<JobRun | undefined> {
  let owner: ResourceLease | null = null;
  try { owner = await ResourceLease.acquireKey(T631_RESOURCE); }
  catch (error) {
    // A protected unit can hold the row beyond a bounded claim wait. Reading
    // history remains useful; this is not evidence that recovery is safe.
    if (!coordinationBusy(error)) throw error;
  }
  if (owner) {
    try { await recoverAbandoned(owner); }
    catch (error) {
      if (!(error instanceof T631RunRefusal) && !(error instanceof SemaphoreLost)) throw error;
    } finally { await owner.close(); }
  }
  // Latest also recovers a completed run when the accepted HTTP response was lost.
  const [run] = await db.select({
    ...getTableColumns(jobRuns),
    // Discovery keeps checking for other tabs' runs without downloading a
    // completed import's potentially large, sensitive details every two seconds.
    output: id ? jobRuns.output : sql<string | null>`NULL`,
  }).from(jobRuns)
    .where(id ? and(scope, eq(jobRuns.id, id)) : scope)
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id)).limit(1);
  return run;
}

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
    throw new T631RunRefusal(403, "T631 sync requires both EDLS and the T631 client component.");
  }
}

async function execute(run: JobRun, owner: ResourceLease) {
  const condition = and(scope, eq(jobRuns.id, run.id), eq(jobRuns.status, "running"));
  const unit: SyncUnit = async work => {
    try {
      owner.assertOwned();
      await runOutsideTransaction(() => runInTransaction(async () => {
        await fence();
        await owner.inTransaction(async () => {
          const [current] = await getClient().select({ id: jobRuns.id }).from(jobRuns).where(condition);
          if (!current) throw new SyncInterrupted();
          await checkEnabled();
          await work();
        });
      }));
    } catch (error) {
      // Reconciliation catches ordinary per-worker failures and continues.
      // Ownership loss must instead stop the whole import, including its
      // missing-worker pass, using its existing interruption contract.
      if (error instanceof SemaphoreLost) throw new SyncInterrupted();
      throw error;
    }
  };
  let beating = false;
  const heartbeat = setInterval(() => {
    if (beating) return;
    try { owner.assertOwned(); } catch { return; }
    beating = true;
    void Promise.resolve(db.update(jobRuns).set({ heartbeatAt: new Date() }).where(condition))
      .catch(() => {}).finally(() => { beating = false; });
  }, 2000);
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
    const result = await syncWorkerEins(remote.data, run.mode === "test", unit);
    const reconciliationMs = performance.now() - reconcileStart;
    const finalizeStart = performance.now();
    await history(owner, async client => {
      const updated = await client.update(jobRuns).set({
        status: "success", completedAt: new Date(), heartbeatAt: new Date(),
        output: JSON.stringify({ dryRun: run.mode === "test", ...result }),
      }).where(condition).returning({ id: jobRuns.id });
      if (!updated.length) throw new SyncInterrupted();
    });
    logger.info("T631 sync phase timings", {
      service: "t631-sync-workers", dryRun: run.mode === "test",
      fetchMs, remoteTimings: remote.timings, reconciliationMs,
      finalizationMs: performance.now() - finalizeStart,
      rowCounts: result.rowCounts, skipped: result.skipped, errors: result.errors,
      edlsDeactivated: result.edlsDeactivated,
    });
  } catch (error) {
    // Lost ownership cannot authorize ANY terminal write. Leave uncertain
    // history for a new lease holder; late external replies are discarded.
    if (error instanceof SemaphoreLost) return;
    try { owner.assertOwned(); } catch { return; }
    const message = error instanceof SyncInterrupted ? interruptedMessage
      : isMaintenanceModeError(error) ? "Maintenance refusal: sync stopped because the site is in maintenance mode."
      : isT631ConfigurationError(error) || error instanceof T631RunRefusal ? "Configuration refusal: check the T631 connection, credentials, and enabled components."
      : error instanceof RemoteFailure ? "Remote failure: T631 timed out, could not be reached, or returned an invalid/unsuccessful worker response. Polling does not extend the vendor timeout."
      : "Sync failed. Partial live changes may remain; review before starting another run.";
    await history(owner, async client => {
      await client.update(jobRuns).set({
        status: error instanceof SyncInterrupted ? "interrupted" : "error",
        error: message, completedAt: new Date(),
      }).where(condition);
    });
  } finally {
    clearInterval(heartbeat);
    await owner.close();
  }
}

function coordinationBusy(error: unknown): boolean {
  return error instanceof SemaphoreLost || (error as { code?: string })?.code === "55P03";
}

export async function startT631Run(dryRun: boolean, actorId: string, wait = false) {
  return runOutsideTransaction(async () => {
    await checkEnabled();
    let owner;
    try { owner = await ResourceLease.acquireKey(T631_RESOURCE); }
    catch (error) {
      if (!coordinationBusy(error)) throw error;
      const [active] = await db.select().from(jobRuns).where(running).limit(1);
      if (active) return { run: active, duplicate: true };
      throw new T631RunRefusal(409, "An interrupted sync is finishing its current worker. Check status before trying again.");
    }
    if (!owner) {
      const [active] = await db.select().from(jobRuns).where(running).limit(1);
      if (!active) throw new T631RunRefusal(409, "Another sync is starting. Refresh status before trying again.");
      return { run: active, duplicate: true };
    }
    let run: JobRun;
    try {
      const claim = await recoverAbandoned(owner, { dryRun, actorId });
      if (!claim.acquired || !claim.run) throw new T631RunRefusal(409, "An interrupted sync is finishing its current worker. Check status before trying again.");
      run = claim.run;
    } catch (error) { await owner.close(); throw error; }
    const context = { ...requestContext.getStore(), userId: actorId === "scheduler" ? undefined : actorId };
    const work = () => requestContext.run(context, () => execute(run, owner));
    if (wait) {
      // Settle the cron waiter promptly, not the external call. The detached
      // executor still guards its next unit/terminal write when it resumes.
      await Promise.race([work(), owner.lost]);
      return { run: (await readT631Run(run.id))!, duplicate: false };
    }
    setImmediate(() => {
      // Persistence failures leave a running row, recovered under a new lease on the
      // next status/start request. Never replay a batch after such a failure.
      void work().catch(() => {});
    });
    return { run, duplicate: false };
  });
}

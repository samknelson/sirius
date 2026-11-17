import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { jobRuns, type JobRun } from "@shared/schema";
import { db, pool } from "../storage/db";
import { getClient, runInTransaction, runOutsideTransaction } from "../storage/transaction-context";
import { allowInMaintenanceMode } from "../storage/maintenance";
import { requestContext } from "../middleware/request-context";
import { assertExternalServiceAllowed, isMaintenanceModeError } from "./maintenance-flag";
import { isComponentEnabled } from "../modules/components";
import { isT631ConfigurationError, t631Fetch } from "../modules/sitespecific/t631/client/fetch";
import { SyncInterrupted, SyncRunRefusal, syncWorkerEins, type SyncUnit } from "../modules/sitespecific/t631/client/sync-workers";
import type { PoolClient } from "pg";

const KIND = "t631-sync";
const PLUGIN = "sitespecific-t631-worker-fetch";
// Session ownership covers fetch + all reconciliation. The second, transaction
// lock fences each worker against takeover if the owning connection is lost.
const OWNER = 2032001;
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

async function acquireOwner(): Promise<PoolClient | null> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [OWNER]);
    if (result.rows[0].acquired) return client;
    client.release();
    return null;
  } catch (error) { client.release(true); throw error; }
}

async function releaseOwner(client: PoolClient) {
  // Destroy rather than return a potentially still-locked session to the pool.
  try { await client.query("SELECT pg_advisory_unlock($1)", [OWNER]); }
  finally { client.release(true); }
}

async function fence() {
  await getClient().execute(sql`SELECT pg_advisory_xact_lock(${FENCE})`);
}

async function recoverAbandoned(owner: PoolClient, create?: { dryRun: boolean; actorId: string }) {
  // Caller owns OWNER. A slow heartbeat is NEVER grounds for takeover.
  // Wait for any last in-flight worker transaction before fencing the old run.
  return runOutsideTransaction(() => allowInMaintenanceMode(async () => {
    const locked = await getClient().execute(sql`SELECT pg_try_advisory_xact_lock(${FENCE}) AS acquired`);
    if (!locked.rows[0]?.acquired) return { acquired: false as const };
    // Prove this session still exists while holding FENCE. If OWNER was lost
    // before we got FENCE, we must not interrupt a replacement executor.
    await owner.query("SELECT 1");
    await getClient().update(jobRuns).set({
      status: "interrupted", error: interruptedMessage, completedAt: new Date(),
    }).where(running);
    if (!create) return { acquired: true as const };
    // Recovery and insertion are ONE fenced commit: there is no gap in which
    // a lost owner can create an unfenced run after a replacement has started.
    await checkEnabled();
    const [run] = await getClient().insert(jobRuns).values({
      pluginKind: KIND, pluginId: PLUGIN, operation: "sync-workers",
      status: "running", mode: create.dryRun ? "test" : "live",
      triggeredBy: create.actorId, heartbeatAt: new Date(),
    }).returning();
    return { acquired: true as const, run };
  }));
}

export async function readT631Run(id?: string): Promise<JobRun | undefined> {
  const owner = await acquireOwner();
  if (owner) {
    owner.on("error", () => {});
    try { await recoverAbandoned(owner); } finally { await releaseOwner(owner); }
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

async function execute(run: JobRun, owner: PoolClient, ownerAlive: () => boolean) {
  const condition = and(scope, eq(jobRuns.id, run.id), eq(jobRuns.status, "running"));
  const unit: SyncUnit = work => runOutsideTransaction(() => runInTransaction(async () => {
    await fence();
    const [current] = await getClient().select({ id: jobRuns.id }).from(jobRuns).where(condition);
    if (!ownerAlive() || !current) throw new SyncInterrupted();
    await checkEnabled();
    await work();
  }));
  let beating = false;
  const heartbeat = setInterval(() => {
    if (beating || !ownerAlive()) return;
    beating = true;
    void Promise.resolve(db.update(jobRuns).set({ heartbeatAt: new Date() }).where(condition))
      .catch(() => {}).finally(() => { beating = false; });
  }, 2000);
  try {
    await checkEnabled();
    const remote = await t631Fetch("sitespecific.t631.worker.list");
    if (!remote.success) throw new RemoteFailure();
    validateT631Workers(remote.data);
    const result = await syncWorkerEins(remote.data, run.mode === "test", unit);
    await runOutsideTransaction(() => allowInMaintenanceMode(async () => {
      await fence();
      if (!ownerAlive()) throw new SyncInterrupted();
      await getClient().update(jobRuns).set({
        status: "success", completedAt: new Date(), heartbeatAt: new Date(),
        output: JSON.stringify({ dryRun: run.mode === "test", ...result }),
      }).where(condition);
    }));
  } catch (error) {
    const message = error instanceof SyncInterrupted ? interruptedMessage
      : isMaintenanceModeError(error) ? "Maintenance refusal: sync stopped because the site is in maintenance mode."
      : isT631ConfigurationError(error) || error instanceof T631RunRefusal ? "Configuration refusal: check the T631 connection, credentials, and enabled components."
      : error instanceof RemoteFailure ? "Remote failure: T631 timed out, could not be reached, or returned an invalid/unsuccessful worker response. Polling does not extend the vendor timeout."
      : "Sync failed. Partial live changes may remain; review before starting another run.";
    await runOutsideTransaction(() => allowInMaintenanceMode(async () => {
      await fence();
      await getClient().update(jobRuns).set({
        status: error instanceof SyncInterrupted ? "interrupted" : "error",
        error: message, completedAt: new Date(),
      }).where(condition);
    }));
  } finally {
    clearInterval(heartbeat);
    await releaseOwner(owner);
  }
}

export async function startT631Run(dryRun: boolean, actorId: string, wait = false) {
  return runOutsideTransaction(async () => {
    await checkEnabled();
    const owner = await acquireOwner();
    if (!owner) {
      const [active] = await db.select().from(jobRuns).where(running).limit(1);
      if (!active) throw new T631RunRefusal(409, "Another sync is starting. Refresh status before trying again.");
      return { run: active, duplicate: true };
    }
    let alive = true;
    owner.on("error", () => { alive = false; });
    let run: JobRun;
    try {
      const claim = await recoverAbandoned(owner, { dryRun, actorId });
      if (!claim.acquired || !claim.run) throw new T631RunRefusal(409, "An interrupted sync is finishing its current worker. Check status before trying again.");
      run = claim.run;
    } catch (error) { await releaseOwner(owner); throw error; }
    const context = { ...requestContext.getStore(), userId: actorId === "scheduler" ? undefined : actorId };
    const work = () => requestContext.run(context, () => execute(run, owner, () => alive));
    if (wait) {
      await work();
      return { run: (await readT631Run(run.id))!, duplicate: false };
    }
    setImmediate(() => {
      // Persistence failures leave a running row, recovered under OWNER on the
      // next status/start request. Never replay a batch after such a failure.
      void work().catch(() => {});
    });
    return { run, duplicate: false };
  });
}

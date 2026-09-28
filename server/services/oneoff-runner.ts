import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { jobRuns, type JobRun, type PluginConfig } from "@shared/schema";
import { db } from "../storage/db";
import { getClient, runInTransaction, runOutsideTransaction } from "../storage/transaction-context";
import { requestContext } from "../middleware/request-context";
import type { OneoffAction, OneoffPlugin, OneoffProgress } from "../plugins/system/oneoff/types";

const STALE_MS = 60_000;
const CONFIRM_MS = 10 * 60_000;
const controllers = new Map<string, AbortController>();

export class OneoffRefusal extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function actionFor(plugin: OneoffPlugin, actionId: string): OneoffAction {
  const action = plugin.actions.find((item) => item.id === actionId);
  if (!action) throw new OneoffRefusal(400, "Unknown Oneoff action");
  return action;
}

function payload(action: string, input: unknown): { action: string; input: unknown } {
  return { action, input: input ?? {} };
}

// Postgres jsonb sorts object keys when it stores them. Comparing ordinary
// JSON.stringify output to a freshly submitted object rejects valid tokens
// whenever the persisted key order differs from the request.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Transaction-scoped advisory lock serializes every operation on a plugin's
// scratch data even when two different configurations or API replicas race.
async function lockPlugin(pluginId: string): Promise<void> {
  await getClient().execute(sql`SELECT pg_advisory_xact_lock(1858, hashtext(${pluginId}))`);
}

async function interruptStale(pluginId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const conditions = [
    eq(jobRuns.pluginKind, "oneoff"),
    eq(jobRuns.status, "running"),
    or(
      lt(jobRuns.heartbeatAt, cutoff),
      and(isNull(jobRuns.heartbeatAt), lt(jobRuns.startedAt, cutoff)),
    ),
  ];
  if (pluginId) conditions.push(eq(jobRuns.pluginId, pluginId));
  await db.update(jobRuns).set({
    status: "interrupted",
    completedAt: new Date(),
    error: "The process stopped responding. Work may have been partially applied; inspect status before retrying.",
  }).where(and(...conditions));
}

export async function interruptStaleOneoffRuns(): Promise<void> {
  await interruptStale();
}

async function claim(pluginId: string, insert: typeof jobRuns.$inferInsert): Promise<JobRun> {
  return runInTransaction(async () => {
    await lockPlugin(pluginId);
    await interruptStale(pluginId);
    const [active] = await getClient().select({ id: jobRuns.id })
      .from(jobRuns).where(and(
        eq(jobRuns.pluginKind, "oneoff"),
        eq(jobRuns.pluginId, pluginId),
        eq(jobRuns.status, "running"),
      )).limit(1);
    if (active) throw new OneoffRefusal(409, "Another run for this plugin is active");
    // A later preflight, even for another configuration of this plugin,
    // supersedes older approvals. Count alone cannot detect a drop followed
    // by recreation of a table with the same number of different rows.
    await getClient().update(jobRuns).set({ confirmationUsedAt: new Date() }).where(and(
      eq(jobRuns.pluginKind, "oneoff"),
      eq(jobRuns.pluginId, pluginId),
      eq(jobRuns.operation, "preflight"),
      eq(jobRuns.status, "success"),
      isNull(jobRuns.confirmationUsedAt),
    ));
    const [run] = await getClient().insert(jobRuns).values(insert).returning();
    return run;
  });
}

export async function preflightOneoff(
  config: PluginConfig,
  plugin: OneoffPlugin,
  actionId: string,
  input: unknown,
  actorId: string,
): Promise<{ runId: string; message: string; rowCount?: number; estimatedDurationMs?: number; confirmationToken: string; destructive: boolean }> {
  const action = actionFor(plugin, actionId);
  const run = await claim(plugin.metadata.id, {
    configurationId: config.id, pluginKind: "oneoff", pluginId: plugin.metadata.id,
    operation: "preflight", status: "running", mode: "live",
    input: payload(actionId, input), triggeredBy: actorId, heartbeatAt: new Date(),
  });
  const heartbeat = setInterval(() => {
    void Promise.resolve(db.update(jobRuns).set({ heartbeatAt: new Date() }).where(and(
      eq(jobRuns.id, run.id), eq(jobRuns.status, "running"),
    ))).catch(() => {
      // The stale detector will handle a prolonged database outage.
    });
  }, 1_000);
  try {
    const result = await action.preflight({
      config, action: actionId, input: input ?? {},
      ...(action.preflightDatabaseAccess === "read-write" ? { db } : {}),
    });
    // Bind destructive approvals to the state the administrator was shown.
    // Recheck after preflight because preflight itself may write scratch data.
    const snapshot = action.destructive ? await plugin.status({ config, db }) : null;
    // A preflight is the server-side authority for a later run. The token is
    // single-use, time-limited, and bound to exact config/action/input.
    const confirmationToken = randomBytes(32).toString("hex");
    const [updated] = await db.update(jobRuns).set({
      status: "success", completedAt: new Date(),
      output: JSON.stringify(result).slice(0, 8_000),
      confirmationHash: hash(confirmationToken),
      checkpoint: snapshot,
    }).where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running"))).returning({ id: jobRuns.id });
    if (!updated) throw new OneoffRefusal(409, "Preflight was interrupted. Try again.");
    return {
      runId: run.id, ...result,
      ...(snapshot ? { rowCount: snapshot.rowCount } : {}),
      confirmationToken, destructive: !!action.destructive,
    };
  } catch (error) {
    await db.update(jobRuns).set({
      status: "error", completedAt: new Date(), error: "Preflight failed. No run was started.",
    }).where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running")));
    if (error instanceof OneoffRefusal) throw error;
    throw new OneoffRefusal(400, "Preflight failed. Check the table shape and run inputs.");
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeRun(run: JobRun, config: PluginConfig, action: OneoffAction, input: unknown, actorId: string): Promise<void> {
  const controller = new AbortController();
  controllers.set(run.id, controller);
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      try {
        const [state] = await db.select({ cancelRequested: jobRuns.cancelRequested, status: jobRuns.status })
          .from(jobRuns).where(eq(jobRuns.id, run.id));
        if (!state || state.status !== "running" || state.cancelRequested) controller.abort();
        if (state?.status === "running") {
          await db.update(jobRuns).set({ heartbeatAt: new Date() })
            .where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running")));
        }
      } catch {
        // A missed heartbeat is visible to the stale-run detector; never fake a
        // success or cancel just because the database was briefly unavailable.
      } finally { checking = false; }
    })();
  }, 1_000);
  try {
    await requestContext.run({ userId: actorId }, async () => {
      const [initial] = await db.select({
        status: jobRuns.status, cancelRequested: jobRuns.cancelRequested,
      }).from(jobRuns).where(eq(jobRuns.id, run.id));
      if (!initial || initial.status !== "running" || initial.cancelRequested) {
        controller.abort();
        throw new Error("Run cancelled before execution");
      }
      const result = await action.execute({
        config, action: action.id, input, signal: controller.signal,
        ...(action.executeDatabaseAccess === "read-write" ? { db } : {}),
        reportProgress: async (progress: OneoffProgress) => {
          const [updated] = await db.update(jobRuns).set({
            progress, checkpoint: progress.checkpoint ?? null, heartbeatAt: new Date(),
          }).where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running"))).returning({ id: jobRuns.id });
          if (!updated || controller.signal.aborted) throw new Error("Run interrupted");
        },
      });
      // The final success is a compare-and-swap against cancellation. If a
      // cancel update won the row lock first, success affects no rows; if
      // success won first, cancelOneoff returns 409 instead of acknowledging
      // a request that could not stop the run.
      const [completed] = controller.signal.aborted ? [] : await db.update(jobRuns).set({
        status: "success", completedAt: new Date(),
        output: JSON.stringify(result ?? null).slice(0, 8_000),
      }).where(and(
        eq(jobRuns.id, run.id), eq(jobRuns.status, "running"),
        eq(jobRuns.cancelRequested, false),
      )).returning({ id: jobRuns.id });
      if (!completed) {
        await db.update(jobRuns).set({
          status: "cancelled", completedAt: new Date(),
          error: "Cancelled. Partial changes may remain; inspect status before retrying.",
        }).where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running")));
      }
    });
  } catch {
    const [failed] = controller.signal.aborted ? [] : await db.update(jobRuns).set({
      status: "error", completedAt: new Date(),
      error: "Run failed. Partial changes may remain; inspect status before retrying.",
    }).where(and(
      eq(jobRuns.id, run.id), eq(jobRuns.status, "running"),
      eq(jobRuns.cancelRequested, false),
    )).returning({ id: jobRuns.id });
    if (!failed) {
      await db.update(jobRuns).set({
        status: "cancelled", completedAt: new Date(),
        error: "Cancelled. Partial changes may remain; inspect status before retrying.",
      }).where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, "running")));
    }
  } finally {
    clearInterval(heartbeat);
    controllers.delete(run.id);
  }
}

export async function startOneoff(
  config: PluginConfig, plugin: OneoffPlugin, actionId: string, input: unknown,
  confirmationToken: string, actorId: string,
): Promise<JobRun> {
  const action = actionFor(plugin, actionId);
  if (!/^[a-f0-9]{64}$/.test(confirmationToken)) throw new OneoffRefusal(409, "Run a new preflight before starting");
  const run = await runInTransaction(async () => {
    await lockPlugin(plugin.metadata.id);
    await interruptStale(plugin.metadata.id);
    const [active] = await getClient().select({ id: jobRuns.id }).from(jobRuns).where(and(
      eq(jobRuns.pluginKind, "oneoff"), eq(jobRuns.pluginId, plugin.metadata.id),
      eq(jobRuns.status, "running"),
    )).limit(1);
    if (active) throw new OneoffRefusal(409, "Another run for this plugin is active");
    const [approved] = await getClient().select().from(jobRuns).where(and(
      eq(jobRuns.configurationId, config.id), eq(jobRuns.pluginKind, "oneoff"),
      eq(jobRuns.pluginId, plugin.metadata.id), eq(jobRuns.operation, "preflight"),
      eq(jobRuns.status, "success"), eq(jobRuns.confirmationHash, hash(confirmationToken)),
      isNull(jobRuns.confirmationUsedAt),
    )).limit(1);
    if (!approved || approved.startedAt.getTime() < Date.now() - CONFIRM_MS ||
        approved.triggeredBy !== actorId ||
        canonicalJson(approved.input) !== canonicalJson(payload(actionId, input))) {
      throw new OneoffRefusal(409, "Preflight expired or inputs changed. Run preflight again.");
    }
    if (action.destructive) {
      const current = await plugin.status({ config, db });
      if (!approved.checkpoint || canonicalJson(approved.checkpoint) !== canonicalJson(current)) {
        throw new OneoffRefusal(409, "The table changed since preflight. Review a new confirmation.");
      }
    }
    await getClient().update(jobRuns).set({ confirmationUsedAt: new Date() }).where(eq(jobRuns.id, approved.id));
    const [created] = await getClient().insert(jobRuns).values({
      configurationId: config.id, pluginKind: "oneoff", pluginId: plugin.metadata.id,
      operation: actionId, status: "running", mode: "live", input: payload(actionId, input),
      heartbeatAt: new Date(), triggeredBy: actorId,
    }).returning();
    return created;
  });
  // The response must not wait for a ten-minute batch. Clear the request's
  // transaction context before scheduling work, even if a caller later wraps
  // this function in a transaction.
  runOutsideTransaction(() => setImmediate(() => {
    void executeRun(run, config, action, input ?? {}, actorId);
  }));
  return run;
}

export async function cancelOneoff(run: JobRun): Promise<void> {
  if (run.operation === "preflight") throw new OneoffRefusal(409, "Preflight cannot be cancelled");
  if (run.status !== "running") throw new OneoffRefusal(409, "This run is no longer active");
  const [updated] = await db.update(jobRuns).set({ cancelRequested: true }).where(and(
    eq(jobRuns.id, run.id), eq(jobRuns.status, "running"),
  )).returning({ id: jobRuns.id });
  if (!updated) throw new OneoffRefusal(409, "This run is no longer active");
  controllers.get(run.id)?.abort();
}

export async function oneoffActiveRun(pluginId: string): Promise<JobRun | undefined> {
  await interruptStale(pluginId);
  const [run] = await db.select().from(jobRuns).where(and(
    eq(jobRuns.pluginKind, "oneoff"), eq(jobRuns.pluginId, pluginId),
    eq(jobRuns.status, "running"),
  )).limit(1);
  return run;
}
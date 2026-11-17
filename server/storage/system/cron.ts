import { createNoopValidator } from "../utils/validation";
import { getClient } from "../transaction-context";
import { jobRuns, users, type JobRun, type InsertJobRun } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";

export const validate = createNoopValidator<InsertJobRun, JobRun>();

export type JobRunWithUser = JobRun & {
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
};

export interface JobRunStorage {
  list(filters?: { configurationId?: string; pluginKind?: string; pluginId?: string; status?: string; limit?: number; offset?: number; summaryOnly?: boolean }): Promise<JobRunWithUser[]>;
  getById(id: string): Promise<JobRunWithUser | undefined>;
  getLatestByConfigurationId(configurationId: string): Promise<JobRunWithUser | undefined>;
  getLatestByPlugin(pluginKind: string, pluginId: string): Promise<JobRunWithUser | undefined>;
  getLastSuccessfulLiveRun(configurationId: string): Promise<JobRun | undefined>;
  create(run: InsertJobRun, owner?: PoolClient): Promise<JobRun>;
  update(id: string, updates: Partial<InsertJobRun>, owner?: PoolClient): Promise<JobRun | undefined>;
  interruptIfRunning(id: string, error: string): Promise<void>;
  interruptAbandonedCronRuns(pluginId: string, currentRunId: string, owner: PoolClient): Promise<number>;
  delete(id: string): Promise<boolean>;
}

// Cron's scheduler (including manual runs) omits startedAt, as required by
// InsertJobRun: now() stores the SQL session's wall clock. Drizzle normally
// labels naive fields UTC, which shifts that start a second time on display.
// Other run kinds are intentionally untouched, as are ORM-written completions.
// Keep this on display reads only: scheduling/dueness retains its existing path.
const displayedStartInstant = sql`
  CASE WHEN ${jobRuns.pluginKind} = 'cron'
    THEN ${jobRuns.startedAt} AT TIME ZONE current_setting('TimeZone')
    ELSE ${jobRuns.startedAt} AT TIME ZONE 'UTC'
  END
`.mapWith((value: string) => new Date(value));

const withUser = {
  id: jobRuns.id,
  configurationId: jobRuns.configurationId,
  pluginKind: jobRuns.pluginKind,
  pluginId: jobRuns.pluginId,
  operation: jobRuns.operation,
  status: jobRuns.status,
  mode: jobRuns.mode,
  output: jobRuns.output,
  error: jobRuns.error,
  input: jobRuns.input,
  progress: jobRuns.progress,
  checkpoint: jobRuns.checkpoint,
  heartbeatAt: jobRuns.heartbeatAt,
  cancelRequested: jobRuns.cancelRequested,
  confirmationHash: jobRuns.confirmationHash,
  confirmationUsedAt: jobRuns.confirmationUsedAt,
  startedAt: displayedStartInstant,
  completedAt: jobRuns.completedAt,
  triggeredBy: jobRuns.triggeredBy,
  userFirstName: users.firstName,
  userLastName: users.lastName,
  userEmail: users.email,
};

export function createJobRunStorage(): JobRunStorage {
  return {
    async list(filters): Promise<JobRunWithUser[]> {
      const conditions = [];
      if (filters?.configurationId) conditions.push(eq(jobRuns.configurationId, filters.configurationId));
      if (filters?.pluginKind) conditions.push(eq(jobRuns.pluginKind, filters.pluginKind));
      if (filters?.pluginId) conditions.push(eq(jobRuns.pluginId, filters.pluginId));
      if (filters?.status) conditions.push(eq(jobRuns.status, filters.status));

      const query = getClient()
        .select(filters?.summaryOnly ? {
          ...withUser,
          // Scheduler output starts with timing fields before the potentially
          // huge summary. Extract only that header; do not cast arbitrary
          // legacy text to JSON or infer duration from naive timestamps.
          output: sql<string | null>`json_build_object('executionTimeSec',
            substring(${jobRuns.output} from
              '^[[:space:]]*[{][[:space:]]*"executionTimeMs"[[:space:]]*:[[:space:]]*[0-9]+[[:space:]]*,[[:space:]]*"executionTimeSec"[[:space:]]*:[[:space:]]*"([0-9]+[.][0-9]+)"'
            ))::text`,
          input: sql<null>`null`,
          progress: sql<null>`null`,
          checkpoint: sql<null>`null`,
          error: sql<string | null>`left(${jobRuns.error}, 500)`,
        } : withUser)
        .from(jobRuns)
        .leftJoin(users, eq(jobRuns.triggeredBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
        .$dynamic();
      if (filters?.limit !== undefined) query.limit(filters.limit);
      if (filters?.offset !== undefined) query.offset(filters.offset);
      return query;
    },

    async getById(id): Promise<JobRunWithUser | undefined> {
      const [run] = await getClient()
        .select(withUser)
        .from(jobRuns)
        .leftJoin(users, eq(jobRuns.triggeredBy, users.id))
        .where(eq(jobRuns.id, id));
      return run;
    },

    async getLatestByConfigurationId(configurationId): Promise<JobRunWithUser | undefined> {
      const [run] = await getClient()
        .select(withUser)
        .from(jobRuns)
        .leftJoin(users, eq(jobRuns.triggeredBy, users.id))
        .where(eq(jobRuns.configurationId, configurationId))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      return run;
    },

    // Display-only history: legacy rows have no provable configuration ID,
    // but still belong to the plugin's timeline. Never use this for dueness.
    async getLatestByPlugin(pluginKind, pluginId): Promise<JobRunWithUser | undefined> {
      const [run] = await getClient()
        .select(withUser)
        .from(jobRuns)
        .leftJoin(users, eq(jobRuns.triggeredBy, users.id))
        .where(and(eq(jobRuns.pluginKind, pluginKind), eq(jobRuns.pluginId, pluginId)))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      return run;
    },

    // Only this configuration's completed live successes count. A running,
    // failed, test or previous configuration's run cannot consume a cron tick.
    async getLastSuccessfulLiveRun(configurationId): Promise<JobRun | undefined> {
      const [run] = await getClient()
        .select()
        .from(jobRuns)
        .where(and(
          eq(jobRuns.configurationId, configurationId),
          eq(jobRuns.pluginKind, "cron"),
          eq(jobRuns.operation, "execute"),
          eq(jobRuns.status, "success"),
          eq(jobRuns.mode, "live"),
        ))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      return run;
    },

    async create(insertRun, owner): Promise<JobRun> {
      validate.validateOrThrow(insertRun);
      // Cron admissions use the short semaphore-guarded transaction:
      // a delayed contender must not publish history behind recovery.
      const [run] = await (owner ? drizzle(owner) : getClient()).insert(jobRuns).values(insertRun).returning();
      return run;
    },

    async update(id, updates, owner): Promise<JobRun | undefined> {
      const [run] = await (owner ? drizzle(owner) : getClient())
        .update(jobRuns)
        .set(updates)
        .where(owner ? and(eq(jobRuns.id, id), eq(jobRuns.status, "running")) : eq(jobRuns.id, id))
        .returning();
      return run;
    },

    async interruptIfRunning(id, error) {
      // Independent, bounded coordination write, never overwrite recovery/success.
      const { semaphoreHistoryTransaction } = await import("./semaphores");
      await semaphoreHistoryTransaction(async client => {
        await drizzle(client).update(jobRuns).set({
          status: "interrupted", completedAt: new Date(), error,
        }).where(and(eq(jobRuns.id, id), eq(jobRuns.pluginKind, "cron"), eq(jobRuns.status, "running")));
      });
    },

    // Caller has validated and row-locked the semaphore in this transaction. History is
    // created only AFTER acquiring that lock, so every other running execute
    // row is from an older ownership, regardless of clocks/configuration/mode.
    // The lease guard checks database expiry again before commit. T631's
    // separate run kind is untouched; partial old work may still be finishing.
    async interruptAbandonedCronRuns(pluginId, currentRunId, owner): Promise<number> {
      const rows = await drizzle(owner).update(jobRuns).set({
        status: "interrupted",
        completedAt: new Date(),
        error: "Previous cron execution lost ownership without a recorded result. Partial work may still be finishing; nothing was automatically replayed.",
      }).where(and(
        eq(jobRuns.pluginKind, "cron"),
        eq(jobRuns.pluginId, pluginId),
        eq(jobRuns.operation, "execute"),
        eq(jobRuns.status, "running"),
        sql`${jobRuns.id} <> ${currentRunId}`,
      )).returning({ id: jobRuns.id });
      return rows.length;
    },

    async delete(id): Promise<boolean> {
      const rows = await getClient().delete(jobRuns).where(eq(jobRuns.id, id)).returning();
      return rows.length > 0;
    },
  };
}
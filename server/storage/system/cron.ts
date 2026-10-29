import { createNoopValidator } from "../utils/validation";
import { getClient } from "../transaction-context";
import { jobRuns, users, type JobRun, type InsertJobRun } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export const validate = createNoopValidator<InsertJobRun, JobRun>();

export type JobRunWithUser = JobRun & {
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
};

export interface JobRunStorage {
  list(filters?: { configurationId?: string; pluginKind?: string; pluginId?: string; status?: string }): Promise<JobRunWithUser[]>;
  getById(id: string): Promise<JobRunWithUser | undefined>;
  getLatestByConfigurationId(configurationId: string): Promise<JobRunWithUser | undefined>;
  getLatestByPlugin(pluginKind: string, pluginId: string): Promise<JobRunWithUser | undefined>;
  getLastSuccessfulLiveRun(configurationId: string): Promise<JobRun | undefined>;
  create(run: InsertJobRun): Promise<JobRun>;
  update(id: string, updates: Partial<InsertJobRun>): Promise<JobRun | undefined>;
  delete(id: string): Promise<boolean>;
}

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
  startedAt: jobRuns.startedAt,
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
        .select(withUser)
        .from(jobRuns)
        .leftJoin(users, eq(jobRuns.triggeredBy, users.id))
        .orderBy(desc(jobRuns.startedAt));
      return conditions.length ? query.where(and(...conditions)) : query;
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

    async create(insertRun): Promise<JobRun> {
      validate.validateOrThrow(insertRun);
      const [run] = await getClient().insert(jobRuns).values(insertRun).returning();
      return run;
    },

    async update(id, updates): Promise<JobRun | undefined> {
      const [run] = await getClient()
        .update(jobRuns)
        .set(updates)
        .where(eq(jobRuns.id, id))
        .returning();
      return run;
    },

    async delete(id): Promise<boolean> {
      const rows = await getClient().delete(jobRuns).where(eq(jobRuns.id, id)).returning();
      return rows.length > 0;
    },
  };
}
import { getClient, onAfterCommit } from "../../transaction-context";
import { desc, eq, getTableName, ilike, or } from "drizzle-orm";
import { contacts, dispatchJobs, workers } from "@shared/schema";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificT631JobInterviews,
  type SitespecificT631JobInterview,
  type InsertSitespecificT631JobInterview,
} from "../../../../shared/schema/sitespecific/t631/interviews-schema";
import { defineLoggingConfig } from "../../middleware/logging";
import { eventBus, EventType } from "../../../services/event-bus";
import { storageLogger } from "../../../logger";

export type { SitespecificT631JobInterview, InsertSitespecificT631JobInterview };

export interface T631InterviewsStorage {
  tableExists(): Promise<boolean>;
  get(id: string): Promise<SitespecificT631JobInterview | undefined>;
  /**
   * Row-locked read (SELECT ... FOR UPDATE). Must be called inside a
   * transaction; used by status transitions so a concurrent change can't
   * slip a stale transition through the validate-then-update window.
   */
  getForUpdate(id: string): Promise<SitespecificT631JobInterview | undefined>;
  getByWorker(workerId: string): Promise<SitespecificT631JobInterview[]>;
  getByJob(jobId: string): Promise<SitespecificT631JobInterview[]>;
  create(record: InsertSitespecificT631JobInterview): Promise<SitespecificT631JobInterview>;
  update(
    id: string,
    record: Partial<InsertSitespecificT631JobInterview>,
  ): Promise<SitespecificT631JobInterview | undefined>;
  /** Returns the deleted row (owner attribution + event emission), or undefined. */
  delete(id: string): Promise<SitespecificT631JobInterview | undefined>;
}

const tableName = getTableName(sitespecificT631JobInterviews);

/**
 * Emit the interview-saved event AFTER the surrounding transaction commits so
 * the denorm plugin never recomputes from pre-commit data. Fire-and-forget:
 * a listener failure must not fail the committed write.
 */
function emitInterviewSaved(
  interview: Pick<SitespecificT631JobInterview, "id" | "workerId" | "jobId" | "status">,
  previousStatus: string | null,
  isDeleted = false,
): void {
  onAfterCommit(() => {
    eventBus
      .emit(EventType.SITESPECIFIC_T631_INTERVIEW_SAVED, {
        interviewId: interview.id,
        workerId: interview.workerId,
        jobId: interview.jobId,
        status: interview.status,
        previousStatus,
        isDeleted,
      })
      .catch((error) => {
        storageLogger.error("Failed to emit t631 interview saved event", {
          service: "t631-interviews-storage",
          interviewId: interview.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

export function createT631InterviewsStorage(): T631InterviewsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async get(id: string): Promise<SitespecificT631JobInterview | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificT631JobInterviews)
        .where(eq(sitespecificT631JobInterviews.id, id));
      return results[0];
    },

    async getForUpdate(id: string): Promise<SitespecificT631JobInterview | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificT631JobInterviews)
        .where(eq(sitespecificT631JobInterviews.id, id))
        .for("update");
      return results[0];
    },

    async getByWorker(workerId: string): Promise<SitespecificT631JobInterview[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      return client
        .select()
        .from(sitespecificT631JobInterviews)
        .where(eq(sitespecificT631JobInterviews.workerId, workerId));
    },

    async getByJob(jobId: string): Promise<SitespecificT631JobInterview[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      return client
        .select()
        .from(sitespecificT631JobInterviews)
        .where(eq(sitespecificT631JobInterviews.jobId, jobId));
    },


    async create(record: InsertSitespecificT631JobInterview): Promise<SitespecificT631JobInterview> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .insert(sitespecificT631JobInterviews)
        .values(record)
        .returning();
      const created = results[0];
      // Creation = arriving at a status with no prior row.
      emitInterviewSaved(created, null);
      return created;
    },

    async update(
      id: string,
      record: Partial<InsertSitespecificT631JobInterview>,
    ): Promise<SitespecificT631JobInterview | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      // Pre-read for the event's previousStatus. Status-transition routes
      // already hold a row lock (getForUpdate) in their transaction, so this
      // read can't race those; a plain edit racing itself may at worst carry a
      // slightly stale previousStatus in the emitted event.
      const prior = await this.get(id);
      const results = await client
        .update(sitespecificT631JobInterviews)
        .set(record)
        .where(eq(sitespecificT631JobInterviews.id, id))
        .returning();
      const updated = results[0];
      if (updated) emitInterviewSaved(updated, prior?.status ?? null);
      return updated;
    },

    async delete(id: string): Promise<SitespecificT631JobInterview | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      // DELETE ... RETURNING: worker attribution and the event payload come
      // from the row actually deleted (no pre-read race).
      const results = await client
        .delete(sitespecificT631JobInterviews)
        .where(eq(sitespecificT631JobInterviews.id, id))
        .returning();
      const deleted = results[0];
      if (deleted) emitInterviewSaved(deleted, deleted.status, true);
      return deleted;
    },
  };
}

function describeInterview(row?: {
  jobId?: string | null;
  status?: string | null;
}): string {
  if (!row) return "interview";
  return `interview for job ${row.jobId ?? "?"} (status: ${row.status ?? "?"})`;
}

/**
 * All mutating methods attribute the log entry to the interview's WORKER
 * (host_entity_id = workerId) so interviews show up on the worker's account
 * log. Delete attribution comes from the DELETE ... RETURNING row.
 */
export const t631InterviewsLoggingConfig = defineLoggingConfig<T631InterviewsStorage>({
  module: "sitespecific.t631.interviews",
  state: { key: "interview" },
  hostEntityIdField: "workerId",
  methods: {
    create: {
      after: async (_args, result) => result,
      getEntityId: (_args, result) => result?.id,
      getDescription: (_args, result) => `Created ${describeInterview(result)}`,
    },
    update: {
      before: async (args, storage) => storage.get(args[0]),
      after: async (_args, result) => result,
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, result, beforeState) => result?.workerId ?? beforeState?.workerId,
      getDescription: (_args, result, beforeState) => {
        const prev = beforeState as SitespecificT631JobInterview | undefined;
        const next = result as SitespecificT631JobInterview | undefined;
        if (prev && next && prev.status !== next.status) {
          return `Updated ${describeInterview(next)} — status ${prev.status} → ${next.status}`;
        }
        return `Updated ${describeInterview(next ?? prev)}`;
      },
    },
    delete: {
      // No `before` read: the deleted row itself (returned by the method) is
      // the atomic source for attribution and description.
      after: async (_args, result) => (result ? { deleted: true, interview: result } : undefined),
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, result) => result?.workerId,
      shouldLog: (_args, result) => result !== undefined,
      getDescription: (_args, result) => `Deleted ${describeInterview(result)}`,
    },
  },
});

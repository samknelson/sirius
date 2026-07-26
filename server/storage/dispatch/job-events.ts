import { getClient, runInTransaction } from '../transaction-context';
import {
  dispatchJobEvent,
  dispatchJobs,
  optionsDispatchJobType,
  events,
  type DispatchJobEvent,
} from "@shared/schema";
import type { JobTypeData } from "@shared/schema/dispatch/eligibility-config";
import { eq, inArray, sql, notExists } from "drizzle-orm";

/**
 * Storage for the `dispatch_job_event` link table (dispatch.bullpen
 * component-owned): the auto-created event for a bullpen-host dispatch job.
 * All bullpen logic lives here so the `dispatch_job_event` denorm plugin —
 * the sole writer — stays a thin wrapper and jobs storage stays
 * bullpen-unaware.
 */
export interface DispatchJobEventStorage {
  /** The link row for a job, if any. */
  getByJob(jobId: string): Promise<DispatchJobEvent | undefined>;
  /**
   * Converge the link row for a job. If the job exists, its type is
   * `bullpen === "host"`, and no link row exists yet: create the event (of the
   * type's `bullpenEventTypeId`, titled after the job) and the link row in ONE
   * transaction; a concurrent-insert unique violation on job_id is treated as
   * "already synced" (no orphan event — the insert is rolled back with it).
   * If a link row already exists, re-point its denorm_id if the denorm status
   * row changed. If the job is missing, throws (the denorm row gets flagged
   * and the widow sweep retires it). A non-host job is a no-op (widow sweep
   * cleans up any stale rows). Throws when a host job type has no
   * `bullpenEventTypeId` configured.
   */
  upsertForJob(jobId: string, denormId: string): Promise<void>;
  /** Job ids of ALL jobs whose type is currently a bullpen host that have no link row (backfill anti-join). */
  listHostJobIdsMissingEvent(limit: number): Promise<string[]>;
  /** Subset of `jobIds` that still exist AND whose type is currently a bullpen host (widow detection). */
  filterHostJobIds(jobIds: string[]): Promise<string[]>;
}

/** True when the job type's data blob says this type hosts a bullpen. */
const HOST_PREDICATE = sql`${optionsDispatchJobType.data}->>'bullpen' = 'host'`;

export function createDispatchJobEventStorage(): DispatchJobEventStorage {
  return {
    async getByJob(jobId: string): Promise<DispatchJobEvent | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(dispatchJobEvent)
        .where(eq(dispatchJobEvent.jobId, jobId));
      return row || undefined;
    },

    async upsertForJob(jobId: string, denormId: string): Promise<void> {
      await runInTransaction(async () => {
        const client = getClient();
        const [row] = await client
          .select({
            jobId: dispatchJobs.id,
            jobTitle: dispatchJobs.title,
            typeData: optionsDispatchJobType.data,
          })
          .from(dispatchJobs)
          .leftJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id))
          .where(eq(dispatchJobs.id, jobId));

        if (!row) {
          throw new Error(`Dispatch job ${jobId} no longer exists`);
        }

        const typeData = (row.typeData ?? {}) as JobTypeData;
        if (typeData.bullpen !== "host") {
          // Not a bullpen host — nothing to create. Any stale link/denorm rows
          // are retired by the widow sweep, not here.
          return;
        }

        const [existing] = await client
          .select()
          .from(dispatchJobEvent)
          .where(eq(dispatchJobEvent.jobId, jobId));
        if (existing) {
          if (existing.denormId !== denormId) {
            await client
              .update(dispatchJobEvent)
              .set({ denormId })
              .where(eq(dispatchJobEvent.id, existing.id));
          }
          return;
        }

        const eventTypeId = typeData.bullpenEventTypeId;
        if (!eventTypeId) {
          throw new Error(
            `Dispatch job ${jobId}'s type is a bullpen host but has no bullpenEventTypeId configured`,
          );
        }

        const [event] = await client
          .insert(events)
          .values({ eventTypeId, title: row.jobTitle })
          .returning();

        // A concurrent sync (event handler vs backfill) racing us would hit
        // the job_id unique constraint here. ON CONFLICT DO NOTHING (instead
        // of catch-and-continue, which would leave the transaction aborted)
        // treats the race as "already synced": delete our now-orphaned event
        // in the same transaction and succeed — the winner's link row is
        // already correct.
        const inserted = await client
          .insert(dispatchJobEvent)
          .values({ jobId, eventId: event.id, denormId })
          .onConflictDoNothing({ target: dispatchJobEvent.jobId })
          .returning({ id: dispatchJobEvent.id });
        if (inserted.length === 0) {
          await client.delete(events).where(eq(events.id, event.id));
        }
      });
    },

    async listHostJobIdsMissingEvent(limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ id: dispatchJobs.id })
        .from(dispatchJobs)
        .innerJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id))
        .where(sql`${HOST_PREDICATE} AND ${notExists(
          client
            .select({ id: dispatchJobEvent.id })
            .from(dispatchJobEvent)
            .where(eq(dispatchJobEvent.jobId, dispatchJobs.id)),
        )}`)
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async filterHostJobIds(jobIds: string[]): Promise<string[]> {
      if (jobIds.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({ id: dispatchJobs.id })
        .from(dispatchJobs)
        .innerJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id))
        .where(sql`${inArray(dispatchJobs.id, jobIds)} AND ${HOST_PREDICATE}`);
      return rows.map((r) => r.id);
    },
  };
}

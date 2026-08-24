import { getClient } from '../transaction-context';
import {
  dispatchJobFacility,
  dispatchJobs,
  facilities,
  employers,
  type DispatchJobFacility,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Child storage layer for the dispatch.facility component's job–facility
 * links (`dispatch_job_facility`). Owned by the dispatch job storage as its
 * delegate: the job storage passes an optional first-class facilityId through
 * on create/update, and ALL facility persistence logic lives here. Each
 * mutation is atomic in its own operation and is audit-logged with the
 * dispatch job as the host/main entity.
 *
 * The table allows multiple facilities per job, but the current UI is a
 * single select — setForJob enforces "at most one link per job" by replacing
 * any existing link.
 */

export interface DispatchJobFacilityWithFacility extends DispatchJobFacility {
  facility?: { id: string; name: string } | null;
}

export interface DispatchJobFacilityStorage {
  /** The job's facility link (at most one today), joined with the facility. */
  getByJob(jobId: string): Promise<DispatchJobFacilityWithFacility | undefined>;
  /**
   * Set the job's facility, replacing any existing link. Upsert respecting
   * the unique (job_id, facility_id) tuple; atomic in its own transaction.
   */
  setForJob(jobId: string, facilityId: string): Promise<DispatchJobFacility>;
  /** Remove the job's facility link(s). Returns true when a row was removed. */
  clearForJob(jobId: string): Promise<boolean>;
}

async function getJobLabel(jobId: string | undefined): Promise<{ title: string; employerName: string }> {
  if (!jobId) return { title: 'Unknown Job', employerName: 'Unknown Employer' };
  const client = getClient();
  const [row] = await client
    .select({ title: dispatchJobs.title, employerName: employers.name })
    .from(dispatchJobs)
    .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
    .where(eq(dispatchJobs.id, jobId));
  return { title: row?.title || 'Unknown Job', employerName: row?.employerName || 'Unknown Employer' };
}

async function getFacilityName(facilityId: string | undefined): Promise<string> {
  if (!facilityId) return 'Unknown Facility';
  const client = getClient();
  const [row] = await client
    .select({ name: facilities.name })
    .from(facilities)
    .where(eq(facilities.id, facilityId));
  return row?.name || 'Unknown Facility';
}

// setForJob/clearForJob are not conventional create/update/delete names, so
// every hook is spelled out explicitly. The dispatch JOB is the host/main
// entity for these logs (args[0] is always the job id).
export const dispatchJobFacilityLoggingConfig = defineLoggingConfig<DispatchJobFacilityStorage>({
  module: 'dispatch-job-facility',
  methods: {
    setForJob: {
      getEntityId: (args, result) => result?.id || `job ${args[0]}`,
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => ({ link: (await storage.getByJob(args[0])) ?? null }),
      after: async (_args, result) => ({ link: result }),
      getDescription: async (args, result, beforeState) => {
        const jobLabel = await getJobLabel(args[0]);
        const facilityName = await getFacilityName(result?.facilityId ?? args[1]);
        const previousFacilityId = beforeState?.link?.facilityId;
        if (previousFacilityId && previousFacilityId !== (result?.facilityId ?? args[1])) {
          const previousName = await getFacilityName(previousFacilityId);
          return `Changed Facility on Dispatch Job "${jobLabel.title}" (${jobLabel.employerName}): ${previousName} → ${facilityName}`;
        }
        return `Set Facility "${facilityName}" on Dispatch Job "${jobLabel.title}" (${jobLabel.employerName})`;
      },
    },
    clearForJob: {
      getEntityId: (args, _result, beforeState) => beforeState?.link?.id || `job ${args[0]}`,
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => ({ link: (await storage.getByJob(args[0])) ?? null }),
      getDescription: async (args, _result, beforeState) => {
        const jobLabel = await getJobLabel(args[0]);
        const facilityName = await getFacilityName(beforeState?.link?.facilityId);
        return `Removed Facility "${facilityName}" from Dispatch Job "${jobLabel.title}" (${jobLabel.employerName})`;
      },
    },
  },
});

export function createDispatchJobFacilityStorage(): DispatchJobFacilityStorage {
  return {
    async getByJob(jobId: string): Promise<DispatchJobFacilityWithFacility | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          link: dispatchJobFacility,
          facility: {
            id: facilities.id,
            name: facilities.name,
          },
        })
        .from(dispatchJobFacility)
        .leftJoin(facilities, eq(dispatchJobFacility.facilityId, facilities.id))
        .where(eq(dispatchJobFacility.jobId, jobId))
        .limit(1);
      if (!row) return undefined;
      return { ...row.link, facility: row.facility || null };
    },

    async setForJob(jobId: string, facilityId: string): Promise<DispatchJobFacility> {
      const client = getClient();
      // Atomic replace: the table permits many facilities per job, but the
      // current product is single-select, so setting a facility removes any
      // other link first. The ON CONFLICT on the (job_id, facility_id)
      // unique tuple makes re-setting the same facility idempotent.
      return client.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(dispatchJobFacility)
          .where(eq(dispatchJobFacility.jobId, jobId));
        if (existing && existing.facilityId !== facilityId) {
          await tx.delete(dispatchJobFacility).where(eq(dispatchJobFacility.jobId, jobId));
        }
        const [link] = await tx
          .insert(dispatchJobFacility)
          .values({ jobId, facilityId })
          .onConflictDoNothing({
            target: [dispatchJobFacility.jobId, dispatchJobFacility.facilityId],
          })
          .returning();
        if (link) return link;
        // Lost the idempotent race (or the same link already existed):
        // read the surviving row back.
        const [current] = await tx
          .select()
          .from(dispatchJobFacility)
          .where(eq(dispatchJobFacility.jobId, jobId));
        if (!current) {
          throw new Error(`Failed to set facility ${facilityId} on dispatch job ${jobId}`);
        }
        return current;
      });
    },

    async clearForJob(jobId: string): Promise<boolean> {
      const client = getClient();
      const deleted = await client
        .delete(dispatchJobFacility)
        .where(eq(dispatchJobFacility.jobId, jobId))
        .returning();
      return deleted.length > 0;
    },
  };
}

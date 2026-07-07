import { getClient } from "../transaction-context";
import {
  grievanceStepsDenorm,
  grievances,
  optionsGrievanceSteps,
  denorm,
  type GrievanceStepsDenorm,
} from "@shared/schema";
import { eq, and, asc, isNull, isNotNull, or } from "drizzle-orm";

/** One computed timeline step row, ready for insertion (plugin-supplied). */
export interface GrievanceTimelineStepRow {
  stepId: string;
  startedYmd: string | null;
  dueYmd: string | null;
  completedYmd: string | null;
  isCurrent: boolean;
  /** Template-step ordering so the UI can render steps in sequence. */
  sequence: number;
}

export interface GrievanceTimelineStepItem extends GrievanceStepsDenorm {
  stepName: string | null;
  stepActor: string | null;
  stepDescription: string | null;
}

/**
 * Storage for the `grievance_steps_denorm` payload table — the computed
 * timeline steps for a grievance. This is the SOLE writer of the table; rows
 * are maintained exclusively by the `grievance_timeline` denorm plugin via
 * {@link replaceForGrievance}. There are NO direct-edit routes.
 */
export interface GrievanceStepsDenormStorage {
  /** The computed step rows for a grievance, joined with step names, in template order. */
  listForGrievance(grievanceId: string): Promise<GrievanceTimelineStepItem[]>;
  /**
   * Replace all denorm step rows for a grievance: delete existing rows and
   * insert the fresh set (zero rows is legal). Caller is responsible for
   * wrapping this in a transaction together with the matching `denorm`
   * status upsert so the two stay consistent.
   */
  replaceForGrievance(
    grievanceId: string,
    denormId: string,
    rows: GrievanceTimelineStepRow[],
  ): Promise<void>;
  /**
   * Backfill anti-join: ids of grievances that HAVE a timeline template but
   * no `denorm` status row for this plugin config. Read-only.
   */
  findIdsMissingDenorm(configId: string, limit: number): Promise<string[]>;
  /**
   * Widow anti-join: entity ids with a `denorm` status row for this config
   * whose grievance no longer exists OR no longer references a timeline
   * template. Read-only; the denorm wrapper deletes these status rows (payload
   * rows cascade).
   */
  findDenormWidowIds(configId: string, limit: number): Promise<string[]>;
}

export function createGrievanceStepsDenormStorage(): GrievanceStepsDenormStorage {
  return {
    async listForGrievance(grievanceId: string): Promise<GrievanceTimelineStepItem[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: grievanceStepsDenorm.id,
          denormId: grievanceStepsDenorm.denormId,
          grievanceId: grievanceStepsDenorm.grievanceId,
          stepId: grievanceStepsDenorm.stepId,
          startedYmd: grievanceStepsDenorm.startedYmd,
          dueYmd: grievanceStepsDenorm.dueYmd,
          completedYmd: grievanceStepsDenorm.completedYmd,
          isCurrent: grievanceStepsDenorm.isCurrent,
          data: grievanceStepsDenorm.data,
          stepName: optionsGrievanceSteps.name,
          stepActor: optionsGrievanceSteps.actor,
          stepDescription: optionsGrievanceSteps.description,
        })
        .from(grievanceStepsDenorm)
        .leftJoin(
          optionsGrievanceSteps,
          eq(grievanceStepsDenorm.stepId, optionsGrievanceSteps.id),
        )
        .where(eq(grievanceStepsDenorm.grievanceId, grievanceId));
      // Template-step order is carried in `data.sequence` (jsonb); sort here
      // so callers always see steps in timeline order.
      return rows.sort((a, b) => {
        const sa = (a.data as { sequence?: number } | null)?.sequence ?? 0;
        const sb = (b.data as { sequence?: number } | null)?.sequence ?? 0;
        return sa - sb;
      });
    },

    async replaceForGrievance(
      grievanceId: string,
      denormId: string,
      rows: GrievanceTimelineStepRow[],
    ): Promise<void> {
      const client = getClient();
      await client
        .delete(grievanceStepsDenorm)
        .where(eq(grievanceStepsDenorm.grievanceId, grievanceId));
      if (rows.length === 0) return;
      await client.insert(grievanceStepsDenorm).values(
        rows.map((row) => ({
          denormId,
          grievanceId,
          stepId: row.stepId,
          startedYmd: row.startedYmd,
          dueYmd: row.dueYmd,
          completedYmd: row.completedYmd,
          isCurrent: row.isCurrent,
          data: { sequence: row.sequence },
        })),
      );
    },

    async findIdsMissingDenorm(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ id: grievances.id })
        .from(grievances)
        .leftJoin(
          denorm,
          and(eq(denorm.entityId, grievances.id), eq(denorm.configId, configId)),
        )
        .where(and(isNotNull(grievances.timelineTemplateId), isNull(denorm.id)))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async findDenormWidowIds(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ entityId: denorm.entityId })
        .from(denorm)
        .leftJoin(grievances, eq(grievances.id, denorm.entityId))
        .where(
          and(
            eq(denorm.configId, configId),
            or(isNull(grievances.id), isNull(grievances.timelineTemplateId)),
          ),
        )
        .limit(limit);
      return rows.map((r) => r.entityId);
    },
  };
}

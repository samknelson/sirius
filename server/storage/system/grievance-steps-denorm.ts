import { getClient } from "../transaction-context";
import {
  grievanceStepsDenorm,
  grievances,
  optionsGrievanceSteps,
  denorm,
  type GrievanceStepsDenorm,
} from "@shared/schema";
import { eq, and, asc, isNull, isNotNull, or } from "drizzle-orm";
import type { GrievanceTimelineAdjustment } from "@shared/schema";

/** One computed timeline step row, ready for insertion (plugin-supplied). */
export interface GrievanceTimelineStepRow {
  stepId: string;
  startedYmd: string | null;
  dueYmd: string | null;
  completedYmd: string | null;
  isCurrent: boolean;
  /** Template-step ordering so the UI can render steps in sequence. */
  sequence: number;
  /**
   * When the step's start entry carried a timeline adjustment: the adjustment
   * itself plus the original (unadjusted) computed due date, recorded in the
   * row's `data` json so the timeline tab can show both.
   */
  adjustment?: GrievanceTimelineAdjustment | null;
  originalDueYmd?: string | null;
  /**
   * The grievance status that STARTED this step (the status of the start
   * entry) and, when the step has completed, the status that COMPLETED it
   * (the status of the completing entry). Recorded in the row's `data` json
   * so the timeline tab can show which specific status began and ended each
   * step. `completeStatusId` is null while the step is still open.
   */
  startStatusId?: string | null;
  completeStatusId?: string | null;
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
  /**
   * Open (not-yet-completed) timeline steps that carry a due date. One row per
   * open occurrence; a step has at most one open occurrence by construction of
   * the timeline derivation. Deleted grievances are excluded automatically (the
   * denorm rows cascade away with the grievance). Read-only; used by the
   * grievance-deadline-reminder scheduler to enumerate reminder candidates.
   * Pass `grievanceId` to scope to a single grievance (the event-driven fast
   * path); omit it to enumerate every open step (the backfill/widow sweep).
   */
  listOpenStepsWithDueDate(
    grievanceId?: string,
  ): Promise<Array<{ grievanceId: string; stepId: string; dueYmd: string }>>;
  /**
   * The single open occurrence of one step on one grievance, with its due date
   * and joined step name — or null when the step is completed, has no due date,
   * or does not exist. Read-only; used by the reminder scheduler's `compute`
   * and `isScheduledEventLive` to price a reminder and to re-verify it just
   * before firing.
   */
  getOpenStep(
    grievanceId: string,
    stepId: string,
  ): Promise<{ dueYmd: string; stepName: string | null } | null>;
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
      // so callers always see steps in timeline order. A step can have more
      // than one occurrence (started, completed, started again), so within the
      // same sequence order chronologically by start date.
      return rows.sort((a, b) => {
        const sa = (a.data as { sequence?: number } | null)?.sequence ?? 0;
        const sb = (b.data as { sequence?: number } | null)?.sequence ?? 0;
        if (sa !== sb) return sa - sb;
        const da = a.startedYmd ?? "";
        const db = b.startedYmd ?? "";
        return da < db ? -1 : da > db ? 1 : 0;
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
          data: {
            sequence: row.sequence,
            ...(row.adjustment
              ? { adjustment: row.adjustment, originalDueYmd: row.originalDueYmd ?? null }
              : {}),
            ...(row.startStatusId ? { startStatusId: row.startStatusId } : {}),
            ...(row.completeStatusId ? { completeStatusId: row.completeStatusId } : {}),
          },
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

    async listOpenStepsWithDueDate(
      grievanceId?: string,
    ): Promise<Array<{ grievanceId: string; stepId: string; dueYmd: string }>> {
      const client = getClient();
      const where = grievanceId
        ? and(
            isNull(grievanceStepsDenorm.completedYmd),
            isNotNull(grievanceStepsDenorm.dueYmd),
            eq(grievanceStepsDenorm.grievanceId, grievanceId),
          )
        : and(
            isNull(grievanceStepsDenorm.completedYmd),
            isNotNull(grievanceStepsDenorm.dueYmd),
          );
      const rows = await client
        .select({
          grievanceId: grievanceStepsDenorm.grievanceId,
          stepId: grievanceStepsDenorm.stepId,
          dueYmd: grievanceStepsDenorm.dueYmd,
        })
        .from(grievanceStepsDenorm)
        .where(where);
      return rows
        .filter((r): r is { grievanceId: string; stepId: string; dueYmd: string } =>
          r.dueYmd != null,
        )
        .map((r) => ({ grievanceId: r.grievanceId, stepId: r.stepId, dueYmd: r.dueYmd }));
    },

    async getOpenStep(
      grievanceId: string,
      stepId: string,
    ): Promise<{ dueYmd: string; stepName: string | null } | null> {
      const client = getClient();
      const rows = await client
        .select({
          dueYmd: grievanceStepsDenorm.dueYmd,
          stepName: optionsGrievanceSteps.name,
        })
        .from(grievanceStepsDenorm)
        .leftJoin(
          optionsGrievanceSteps,
          eq(grievanceStepsDenorm.stepId, optionsGrievanceSteps.id),
        )
        .where(
          and(
            eq(grievanceStepsDenorm.grievanceId, grievanceId),
            eq(grievanceStepsDenorm.stepId, stepId),
            isNull(grievanceStepsDenorm.completedYmd),
            isNotNull(grievanceStepsDenorm.dueYmd),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || row.dueYmd == null) return null;
      return { dueYmd: row.dueYmd, stepName: row.stepName };
    },
  };
}

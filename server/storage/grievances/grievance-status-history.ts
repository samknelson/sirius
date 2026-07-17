import { getClient, runInTransaction, onAfterCommit } from "../transaction-context";
import {
  grievances,
  grievanceStatusHistory,
  optionsGrievanceStatus,
  TIMELINE_ADJUSTMENT_DATA_KEY,
  type GrievanceStatusHistory,
  type GrievanceTimelineAdjustment,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Emit the status-history-saved event once the surrounding transaction
 * commits, so the `grievance_timeline` denorm plugin recomputes the
 * grievance's timeline steps from committed data. Best-effort: a failed emit
 * never fails the write.
 */
/**
 * The grievance's derived current status at a point in time: id + resolved
 * name, both null when the grievance has no history (or the status option is
 * missing). Captured before and after a mutation so the emitted event can
 * describe a genuine status transition.
 */
interface CurrentStatusRef {
  statusId: string | null;
  statusName: string | null;
}

/**
 * Read the grievance's current status (the `is_current` entry) with its
 * resolved name. Call inside the mutation transaction: before `recomputeIsCurrent`
 * to capture the previous status, and after it to capture the new one.
 */
async function getCurrentStatus(grievanceId: string): Promise<CurrentStatusRef> {
  const client = getClient();
  const [row] = await client
    .select({
      statusId: grievanceStatusHistory.statusId,
      statusName: optionsGrievanceStatus.name,
    })
    .from(grievanceStatusHistory)
    .leftJoin(
      optionsGrievanceStatus,
      eq(grievanceStatusHistory.statusId, optionsGrievanceStatus.id),
    )
    .where(
      and(
        eq(grievanceStatusHistory.grievanceId, grievanceId),
        eq(grievanceStatusHistory.isCurrent, true),
      ),
    )
    .limit(1);
  return {
    statusId: row?.statusId ?? null,
    statusName: row?.statusName ?? null,
  };
}

function emitStatusHistorySaved(
  grievanceId: string,
  previous: CurrentStatusRef,
  next: CurrentStatusRef,
): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.GRIEVANCE_STATUS_HISTORY_SAVED, {
      grievanceId,
      previousStatusId: previous.statusId,
      previousStatusName: previous.statusName,
      newStatusId: next.statusId,
      newStatusName: next.statusName,
    });
  });
}

export interface GrievanceStatusHistoryItem extends GrievanceStatusHistory {
  statusName: string | null;
  /**
   * The `open` flag of the referenced grievance status (null if the status
   * row is missing). A closed status (`false`) terminates the current
   * timeline step in the `grievance_timeline` denorm.
   */
  statusOpen: boolean | null;
}

/**
 * Storage for a grievance's status history. Owned by the `grievance`
 * component. The grievance's current status is derived, not stored on the
 * grievance row: the history entry with the latest `date` is current.
 *
 * Every mutation (create/update/delete) runs in a transaction that recomputes
 * `is_current` for the affected grievance — clear the flag first, then set it
 * on the latest-dated row — so the partial unique index
 * (`grievance_status_history_one_current_per_grievance`) is never violated
 * mid-transaction. Zero history entries is a legal state (status is blank).
 */
export interface GrievanceStatusHistoryStorage {
  list(grievanceId: string): Promise<GrievanceStatusHistoryItem[]>;
  get(
    grievanceId: string,
    entryId: string,
  ): Promise<GrievanceStatusHistory | undefined>;
  create(
    grievanceId: string,
    data: { statusId: string; date: Date; data?: unknown },
  ): Promise<GrievanceStatusHistory>;
  update(
    grievanceId: string,
    entryId: string,
    data: { statusId?: string; date?: Date },
  ): Promise<GrievanceStatusHistory | undefined>;
  delete(grievanceId: string, entryId: string): Promise<boolean>;
  /**
   * Set or clear (pass null) the timeline adjustment stored under the
   * `timelineAdjustment` key of the entry's `data` jsonb. Merges — other keys
   * in `data` are preserved. Fires the status-history-saved event so the
   * timeline denorm recomputes.
   */
  setTimelineAdjustment(
    grievanceId: string,
    entryId: string,
    adjustment: GrievanceTimelineAdjustment | null,
  ): Promise<GrievanceStatusHistory | undefined>;
}

/**
 * Recompute the derived `is_current` flag for one grievance. Must run inside
 * the same transaction as the mutation that made it stale. Clears all flags
 * for the grievance first, then flags the latest-dated entry (unique
 * (grievance_id, date) guarantees no ties). No-op flag-set when the grievance
 * has zero entries.
 *
 * Also see `lockGrievance` below.
 */
/**
 * Serialize concurrent status-history mutations for one grievance by taking a
 * row lock on the parent grievance. Must be called FIRST inside each mutation
 * transaction — otherwise two concurrent transactions can interleave their
 * clear/set steps and trip the one-current-per-grievance partial unique index.
 */
async function lockGrievance(grievanceId: string): Promise<void> {
  const client = getClient();
  await client
    .select({ id: grievances.id })
    .from(grievances)
    .where(eq(grievances.id, grievanceId))
    .for("update");
}

async function recomputeIsCurrent(grievanceId: string): Promise<void> {
  const client = getClient();
  await client
    .update(grievanceStatusHistory)
    .set({ isCurrent: false })
    .where(
      and(
        eq(grievanceStatusHistory.grievanceId, grievanceId),
        eq(grievanceStatusHistory.isCurrent, true),
      ),
    );
  const [latest] = await client
    .select({ id: grievanceStatusHistory.id })
    .from(grievanceStatusHistory)
    .where(eq(grievanceStatusHistory.grievanceId, grievanceId))
    .orderBy(desc(grievanceStatusHistory.date))
    .limit(1);
  if (latest) {
    await client
      .update(grievanceStatusHistory)
      .set({ isCurrent: true })
      .where(eq(grievanceStatusHistory.id, latest.id));
  }
}

export function createGrievanceStatusHistoryStorage(): GrievanceStatusHistoryStorage {
  return {
    async list(grievanceId: string): Promise<GrievanceStatusHistoryItem[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: grievanceStatusHistory.id,
          grievanceId: grievanceStatusHistory.grievanceId,
          statusId: grievanceStatusHistory.statusId,
          date: grievanceStatusHistory.date,
          isCurrent: grievanceStatusHistory.isCurrent,
          data: grievanceStatusHistory.data,
          statusName: optionsGrievanceStatus.name,
          statusOpen: optionsGrievanceStatus.open,
        })
        .from(grievanceStatusHistory)
        .leftJoin(
          optionsGrievanceStatus,
          eq(grievanceStatusHistory.statusId, optionsGrievanceStatus.id),
        )
        .where(eq(grievanceStatusHistory.grievanceId, grievanceId))
        .orderBy(desc(grievanceStatusHistory.date));
      return rows;
    },

    async get(
      grievanceId: string,
      entryId: string,
    ): Promise<GrievanceStatusHistory | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceStatusHistory)
        .where(
          and(
            eq(grievanceStatusHistory.id, entryId),
            eq(grievanceStatusHistory.grievanceId, grievanceId),
          ),
        );
      return row || undefined;
    },

    async create(
      grievanceId: string,
      data: { statusId: string; date: Date; data?: unknown },
    ): Promise<GrievanceStatusHistory> {
      return runInTransaction(async () => {
        const client = getClient();
        await lockGrievance(grievanceId);
        // Capture the current status BEFORE the mutation so an edit to the
        // currently-current entry doesn't make `previous` read back the new value.
        const previous = await getCurrentStatus(grievanceId);
        const [row] = await client
          .insert(grievanceStatusHistory)
          .values({
            grievanceId,
            statusId: data.statusId,
            date: data.date,
            isCurrent: false,
            data: data.data ?? null,
          })
          .returning();
        await recomputeIsCurrent(grievanceId);
        const next = await getCurrentStatus(grievanceId);
        const [fresh] = await client
          .select()
          .from(grievanceStatusHistory)
          .where(eq(grievanceStatusHistory.id, row.id));
        emitStatusHistorySaved(grievanceId, previous, next);
        return fresh;
      });
    },

    async update(
      grievanceId: string,
      entryId: string,
      data: { statusId?: string; date?: Date },
    ): Promise<GrievanceStatusHistory | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        await lockGrievance(grievanceId);
        const previous = await getCurrentStatus(grievanceId);
        const set: Partial<typeof grievanceStatusHistory.$inferInsert> = {};
        if (data.statusId !== undefined) set.statusId = data.statusId;
        if (data.date !== undefined) set.date = data.date;
        const [row] = await client
          .update(grievanceStatusHistory)
          .set(set)
          .where(
            and(
              eq(grievanceStatusHistory.id, entryId),
              eq(grievanceStatusHistory.grievanceId, grievanceId),
            ),
          )
          .returning();
        if (!row) return undefined;
        await recomputeIsCurrent(grievanceId);
        const next = await getCurrentStatus(grievanceId);
        const [fresh] = await client
          .select()
          .from(grievanceStatusHistory)
          .where(eq(grievanceStatusHistory.id, row.id));
        emitStatusHistorySaved(grievanceId, previous, next);
        return fresh || undefined;
      });
    },

    async delete(grievanceId: string, entryId: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        await lockGrievance(grievanceId);
        const previous = await getCurrentStatus(grievanceId);
        const result = await client
          .delete(grievanceStatusHistory)
          .where(
            and(
              eq(grievanceStatusHistory.id, entryId),
              eq(grievanceStatusHistory.grievanceId, grievanceId),
            ),
          )
          .returning();
        if (result.length === 0) return false;
        await recomputeIsCurrent(grievanceId);
        const next = await getCurrentStatus(grievanceId);
        emitStatusHistorySaved(grievanceId, previous, next);
        return true;
      });
    },

    async setTimelineAdjustment(
      grievanceId: string,
      entryId: string,
      adjustment: GrievanceTimelineAdjustment | null,
    ): Promise<GrievanceStatusHistory | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        await lockGrievance(grievanceId);
        const [existing] = await client
          .select()
          .from(grievanceStatusHistory)
          .where(
            and(
              eq(grievanceStatusHistory.id, entryId),
              eq(grievanceStatusHistory.grievanceId, grievanceId),
            ),
          )
          .for("update");
        if (!existing) return undefined;
        // Merge into the existing `data` jsonb — preserve unrelated keys.
        const currentData =
          existing.data && typeof existing.data === "object"
            ? { ...(existing.data as Record<string, unknown>) }
            : {};
        if (adjustment === null) {
          delete currentData[TIMELINE_ADJUSTMENT_DATA_KEY];
        } else {
          currentData[TIMELINE_ADJUSTMENT_DATA_KEY] = adjustment;
        }
        const newData = Object.keys(currentData).length > 0 ? currentData : null;
        const [row] = await client
          .update(grievanceStatusHistory)
          .set({ data: newData })
          .where(eq(grievanceStatusHistory.id, existing.id))
          .returning();
        // A timeline-adjustment edit never changes the derived current status,
        // so report no transition (previous === current) — the timeline denorm
        // still recomputes off `grievanceId`, but a status notifier won't fire.
        const current = await getCurrentStatus(grievanceId);
        emitStatusHistorySaved(grievanceId, current, current);
        return row || undefined;
      });
    },
  };
}

export const grievanceStatusHistoryLoggingConfig: StorageLoggingConfig<GrievanceStatusHistoryStorage> =
  {
    module: "grievanceStatusHistory",
    methods: {
      create: {
        enabled: true,
        getEntityId: (_args, result) => result?.id,
        getHostEntityId: (args) => args[0],
        after: async (_args, result) => result,
        getDescription: async () => `Added status history entry to grievance`,
      },
      update: {
        enabled: true,
        getEntityId: (args) => args[1],
        getHostEntityId: (args) => args[0],
        after: async (_args, result) => result,
        getDescription: async () => `Updated status history entry on grievance`,
      },
      delete: {
        enabled: true,
        getEntityId: (args) => args[1],
        getHostEntityId: (args) => args[0],
        getDescription: async () => `Removed status history entry from grievance`,
      },
      setTimelineAdjustment: {
        enabled: true,
        getEntityId: (args) => args[1],
        getHostEntityId: (args) => args[0],
        after: async (_args, result) => result,
        getDescription: async (args) =>
          args[2] === null
            ? `Removed timeline adjustment from grievance status history entry`
            : `Set timeline adjustment on grievance status history entry`,
      },
    },
  };

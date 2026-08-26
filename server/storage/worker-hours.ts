import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  workerHours,
  employers,
  optionsEmploymentStatus,
  type WorkerHours,
} from "@shared/schema";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import type { WorkerEmploymentRow } from "./system/worker-employment-denorm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { storageLogger as logger } from "../logger";
import type { LedgerNotification } from "../plugins/ledger/charge/types";
import { eventBus, EventType } from "../services/event-bus";
import {
  areChargePluginsSuppressed,
  areNotificationsSuppressed,
} from "../middleware/request-context";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerHoursResult {
  data: WorkerHours;
  notifications: LedgerNotification[];
}

export interface WorkerHoursDeleteResult {
  success: boolean;
  notifications: LedgerNotification[];
}

/** One monthly (day=1) aggregate row for the migration bulk upsert. */
export interface BulkMigrationHoursRow {
  workerId: string;
  employerId: string;
  year: number;
  month: number;
  employmentStatusId: string;
  hours: number;
}

/** What the migration bulk upsert persisted, per row. `inserted` is the
 * xmax=0 insert-vs-conflict-update discriminator (operational evidence). */
export interface BulkMigrationHoursPersistedRow {
  id: string;
  workerId: string;
  employerId: string;
  year: number;
  month: number;
  hours: number | null;
  employmentStatusId: string;
  inserted: boolean;
}

export interface EmployerWorkerCount {
  employerId: string;
  workerCount: number;
}

export interface WorkerHoursStorage {
  getDistinctWorkerCountsByEmployer(): Promise<EmployerWorkerCount[]>;
  /**
   * Compute a worker's current employment from hours history: one row per
   * employer (that employer's latest hours row), carrying that row's `job_title`.
   * Exactly one returned row is flagged `home = true` (the first employer, by
   * employer-id ordering, whose latest row is flagged home), matching the legacy
   * scalar home-employer derivation. Used by the `worker_employment` denorm
   * plugin to populate `worker_employment_denorm`.
   */
  getCurrentEmployment(workerId: string): Promise<WorkerEmploymentRow[]>;
  getWorkerHoursById(id: string): Promise<any | undefined>;
  getWorkerHours(workerId: string): Promise<any[]>;
  getWorkerHoursCurrent(workerId: string): Promise<any[]>;
  getWorkerHoursHistory(workerId: string): Promise<any[]>;
  getWorkerHoursMonthly(workerId: string): Promise<any[]>;
  getWorkerYearlyHoursTotal(workerId: string, year: number): Promise<number>;
  createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean; jobTitle?: string | null }): Promise<WorkerHoursResult>;
  updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean; jobTitle?: string | null }): Promise<WorkerHoursResult | undefined>;
  deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult>;
  /**
   * Upsert one hours row keyed by (worker, employer, year, month, day).
   * `day` defaults to 1 — the historical single-row-per-month behavior.
   * Callers that need MULTIPLE rows in the same month (e.g. the BAO FMLA
   * split writing an Active row and an FMLA row) pass distinct days.
   *
   * `options.skipHomeEmployerEvent` — when true, the pre/post
   * `deriveHomeEmployerId` queries and `emitEmploymentSavedIfChanged` call are
   * skipped entirely. Safe when the caller knows `home` is not set in `data`
   * (i.e. a bulk upload that never touches the home flag) — saves 2 DB round-
   * trips per row with identical ledger/event semantics.
   */
  upsertWorkerHours(data: { workerId: string; month: number; year: number; day?: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean; jobTitle?: string | null }, options?: { skipHomeEmployerEvent?: boolean }): Promise<WorkerHoursResult>;
  /**
   * MIGRATION-ONLY bounded batch upsert of monthly (day=1) aggregate rows,
   * keyed by the (worker, employer, year, month, day) unique constraint.
   *
   * Fail-closed: throws unless the caller runs inside BOTH the charge-plugin
   * AND notification suppression scopes — this method deliberately skips
   * every per-row side effect of `upsertWorkerHours` (per-row audit
   * snapshots, HOURS_SAVED events, direct charge-plugin execution,
   * home-employer derivation/eventing, per-worker scan invalidation), which
   * is only safe under a migration loader that reinstates the required
   * downstream effects in bulk (see scripts/s1-migration/load-hours.ts).
   *
   * Conflict updates touch ONLY the migration-owned fields
   * (`employment_status_id`, `hours`): existing row ids and staff-owned
   * `home` / `job_title` values survive by construction. Returns every
   * persisted row (throws if the database returns fewer rows than sent —
   * nothing is silently dropped).
   */
  bulkUpsertWorkerHoursMigration(rows: BulkMigrationHoursRow[]): Promise<BulkMigrationHoursPersistedRow[]>;
  /**
   * Lightweight targeted read: return just the (id, day) pairs for a specific
   * (worker, employer, year, month). Used by `reconcileMonthRows` as a fast
   * fallback when the bulk pre-fetch cache is unavailable — avoids loading
   * the worker's entire hours history across all employers and months.
   */
  getWorkerHoursForMonth(workerId: string, employerId: string, year: number, month: number): Promise<Array<{ id: string; day: number }>>;
  /**
   * Bulk read for all workers in a given (employer, year, month): returns a
   * Map<workerId, [{id, day}]>. Used by the BAO upload wizard to pre-load the
   * full month's existing rows in ONE query before processing begins, so
   * `reconcileMonthRows` never hits the DB per-worker during the loop.
   */
  getWorkerHoursForEmployerMonth(employerId: string, year: number, month: number): Promise<Map<string, Array<{ id: string; day: number }>>>;
  getDistinctWorkerIdsByStatusAndMonths(
    statusIds: string[],
    months: Array<{ year: number; month: number }>,
  ): Promise<string[]>;
  getEmployerMonthRowsByWorkerStatusAndMonths(
    workerId: string,
    statusIds: string[],
    months: Array<{ year: number; month: number }>,
  ): Promise<Array<{ year: number; month: number; employerId: string }>>;
}

export function createWorkerHoursStorage(
  onWorkerDataChanged?: (workerId: string) => Promise<void>
): WorkerHoursStorage {
  async function notifyWorkerDataChanged(workerId: string): Promise<void> {
    if (onWorkerDataChanged) {
      await onWorkerDataChanged(workerId).catch(err => {
        console.error("Failed to trigger scan invalidation for worker", workerId, err);
      });
    }
  }

  /**
   * Derive the worker's current home employer from hours history: the first
   * employer (by employer-id ordering) whose latest hours row is flagged
   * home — the exact derivation `getCurrentEmployment` uses. Null when no
   * latest row is flagged home.
   */
  async function deriveHomeEmployerId(workerId: string): Promise<string | null> {
    const client = getClient();
    const result = await client.execute(sql`
      SELECT DISTINCT ON (employer_id)
        employer_id,
        home
      FROM worker_hours
      WHERE worker_id = ${workerId}
      ORDER BY employer_id, year DESC, month DESC, day DESC
    `);
    const rows = result.rows as Array<{ employer_id: string; home: boolean | null }>;
    return rows.find(r => r.home === true)?.employer_id ?? null;
  }

  function monthYmd(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  /**
   * Emit WORKER_EMPLOYMENT_SAVED when a mutation changed the worker's derived
   * home employer. The home employer determines which policy scans the worker
   * when they have no active election, so listeners (WMB auto-rescan) react
   * by re-queueing the worker. Fire-and-forget like HOURS_SAVED; listeners
   * defer their side effects to after commit.
   */
  function emitEmploymentSavedIfChanged(
    workerId: string,
    previousHomeEmployerId: string | null,
    newHomeEmployerId: string | null,
    effectiveYmd: string | null,
  ): void {
    if (previousHomeEmployerId === newHomeEmployerId) return;
    eventBus.emit(EventType.WORKER_EMPLOYMENT_SAVED, {
      workerId,
      previousHomeEmployerId,
      newHomeEmployerId,
      effectiveYmd,
    }).catch(err => {
      logger.error("Failed to emit WORKER_EMPLOYMENT_SAVED event", {
        service: "worker-hours-storage",
        workerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const storage: WorkerHoursStorage = {
    async getDistinctWorkerCountsByEmployer(): Promise<EmployerWorkerCount[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT employer_id, COUNT(DISTINCT worker_id)::int AS worker_count
        FROM worker_hours
        WHERE employer_id IS NOT NULL
        GROUP BY employer_id
      `);
      return (result.rows as Array<{ employer_id: string; worker_count: number }>).map(row => ({
        employerId: row.employer_id,
        workerCount: Number(row.worker_count) || 0,
      }));
    },

    async getCurrentEmployment(workerId: string): Promise<WorkerEmploymentRow[]> {
      const client = getClient();

      // One row per employer: that employer's latest hours row, carrying its
      // own `home` flag and `job_title`.
      const result = await client.execute(sql`
        SELECT DISTINCT ON (employer_id)
          employer_id,
          home,
          job_title
        FROM worker_hours
        WHERE worker_id = ${workerId}
        ORDER BY employer_id, year DESC, month DESC, day DESC
      `);

      const rows = result.rows as Array<{ employer_id: string; home: boolean | null; job_title: string | null }>;

      // Pick the single home employer: the first employer (by employer-id
      // ordering) whose latest hours row is flagged home, matching the legacy
      // scalar derivation exactly. A worker may legitimately have NO home
      // employer — if no latest row is flagged home, no row carries home = true
      // and home-derived reads resolve to null, preserving the legacy nullable
      // `denorm_home_employer_id` behavior that downstream callers branch on.
      // At most one stored row is ever home = true, so home-row reads stay
      // unambiguous.
      const homeEmployerId = rows.find(r => r.home === true)?.employer_id ?? null;

      return rows.map(r => ({
        employerId: r.employer_id,
        home: homeEmployerId !== null && r.employer_id === homeEmployerId,
        jobTitle: r.job_title,
      }));
    },

    async getWorkerHoursById(id: string): Promise<any | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          id: workerHours.id,
          month: workerHours.month,
          year: workerHours.year,
          day: workerHours.day,
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employmentStatusId: workerHours.employmentStatusId,
          hours: workerHours.hours,
          home: workerHours.home,
          jobTitle: workerHours.jobTitle,
          employer: employers,
          employmentStatus: optionsEmploymentStatus,
        })
        .from(workerHours)
        .leftJoin(employers, eq(workerHours.employerId, employers.id))
        .leftJoin(optionsEmploymentStatus, eq(workerHours.employmentStatusId, optionsEmploymentStatus.id))
        .where(eq(workerHours.id, id));

      return result || undefined;
    },

    async getWorkerHours(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: workerHours.id,
          month: workerHours.month,
          year: workerHours.year,
          day: workerHours.day,
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employmentStatusId: workerHours.employmentStatusId,
          hours: workerHours.hours,
          home: workerHours.home,
          jobTitle: workerHours.jobTitle,
          employer: employers,
          employmentStatus: optionsEmploymentStatus,
        })
        .from(workerHours)
        .leftJoin(employers, eq(workerHours.employerId, employers.id))
        .leftJoin(optionsEmploymentStatus, eq(workerHours.employmentStatusId, optionsEmploymentStatus.id))
        .where(eq(workerHours.workerId, workerId))
        .orderBy(desc(workerHours.year), desc(workerHours.month));

      return results;
    },

    async getWorkerHoursCurrent(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        SELECT DISTINCT ON (wh.employer_id)
          wh.id,
          wh.month,
          wh.year,
          wh.day,
          wh.worker_id,
          wh.employer_id,
          wh.employment_status_id,
          wh.home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM worker_hours wh
        LEFT JOIN employers e ON wh.employer_id = e.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.worker_id = ${workerId}
        ORDER BY wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
      `);

      return results.rows.map((row: any) => ({
        id: row.id,
        month: row.month,
        year: row.year,
        day: row.day,
        workerId: row.worker_id,
        employerId: row.employer_id,
        employmentStatusId: row.employment_status_id,
        home: row.home,
        employer: {
          id: row['employer.id'],
          siriusId: row['employer.siriusId'],
          name: row['employer.name'],
          isActive: row['employer.isActive'],
        },
        employmentStatus: {
          id: row['employmentStatus.id'],
          name: row['employmentStatus.name'],
          code: row['employmentStatus.code'],
          employed: row['employmentStatus.employed'],
          description: row['employmentStatus.description'],
        },
      }));
    },

    async getWorkerHoursHistory(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        WITH status_changes AS (
          SELECT
            wh.id,
            wh.month,
            wh.year,
            wh.day,
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            wh.home,
            LAG(wh.employment_status_id) OVER (
              PARTITION BY wh.employer_id 
              ORDER BY wh.year, wh.month, wh.day
            ) AS prev_status_id
          FROM worker_hours wh
          WHERE wh.worker_id = ${workerId}
        )
        SELECT
          sc.id,
          sc.month,
          sc.year,
          sc.day,
          sc.worker_id,
          sc.employer_id,
          sc.employment_status_id,
          sc.home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM status_changes sc
        LEFT JOIN employers e ON sc.employer_id = e.id
        LEFT JOIN options_employment_status es ON sc.employment_status_id = es.id
        WHERE sc.prev_status_id IS NULL OR sc.prev_status_id != sc.employment_status_id
        ORDER BY sc.year DESC, sc.month DESC, sc.day DESC, sc.employer_id
      `);

      return results.rows.map((row: any) => ({
        id: row.id,
        month: row.month,
        year: row.year,
        day: row.day,
        workerId: row.worker_id,
        employerId: row.employer_id,
        employmentStatusId: row.employment_status_id,
        home: row.home,
        employer: {
          id: row['employer.id'],
          siriusId: row['employer.siriusId'],
          name: row['employer.name'],
          isActive: row['employer.isActive'],
        },
        employmentStatus: {
          id: row['employmentStatus.id'],
          name: row['employmentStatus.name'],
          code: row['employmentStatus.code'],
          employed: row['employmentStatus.employed'],
          description: row['employmentStatus.description'],
        },
      }));
    },

    async getWorkerHoursMonthly(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        SELECT
          wh.employer_id,
          wh.year,
          wh.month,
          SUM(wh.hours) AS total_hours,
          wh.employment_status_id,
          BOOL_AND(wh.home) AS all_home,
          BOOL_OR(wh.home) AS some_home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM worker_hours wh
        LEFT JOIN employers e ON wh.employer_id = e.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.worker_id = ${workerId}
        GROUP BY wh.employer_id, wh.year, wh.month, wh.employment_status_id,
                 e.id, e.sirius_id, e.name, e.is_active,
                 es.id, es.name, es.code, es.employed, es.description
        ORDER BY wh.year DESC, wh.month DESC, wh.employer_id
      `);

      return results.rows.map((row: any) => {
        let homeStatus: 'all' | 'some' | 'none';
        if (row.all_home) {
          homeStatus = 'all';
        } else if (row.some_home) {
          homeStatus = 'some';
        } else {
          homeStatus = 'none';
        }

        return {
          employerId: row.employer_id,
          year: row.year,
          month: row.month,
          totalHours: row.total_hours,
          employmentStatusId: row.employment_status_id,
          homeStatus,
          employer: {
            id: row['employer.id'],
            siriusId: row['employer.siriusId'],
            name: row['employer.name'],
            isActive: row['employer.isActive'],
          },
          employmentStatus: {
            id: row['employmentStatus.id'],
            name: row['employmentStatus.name'],
            code: row['employmentStatus.code'],
            employed: row['employmentStatus.employed'],
            description: row['employmentStatus.description'],
          },
        };
      });
    },

    async getWorkerYearlyHoursTotal(workerId: string, year: number): Promise<number> {
      const client = getClient();
      const [result] = await client
        .select({ totalHours: sql<number>`COALESCE(SUM(${workerHours.hours}), 0)` })
        .from(workerHours)
        .where(and(
          eq(workerHours.workerId, workerId),
          eq(workerHours.year, year)
        ));
      return Number(result?.totalHours || 0);
    },

    async createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult> {
      validate.validateOrThrow(data);
      const client = getClient();
      const preHomeEmployerId = await deriveHomeEmployerId(data.workerId);
      const [savedHours] = await client
        .insert(workerHours)
        .values(data)
        .returning();

      let notifications: LedgerNotification[] = [];

      if (savedHours) {
        const payload = {
          hoursId: savedHours.id,
          workerId: savedHours.workerId,
          employerId: savedHours.employerId,
          year: savedHours.year,
          month: savedHours.month,
          day: savedHours.day,
          hours: savedHours.hours || 0,
          employmentStatusId: savedHours.employmentStatusId,
          home: savedHours.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../plugins/ledger/charge");
          const result = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours create", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (savedHours) {
        emitEmploymentSavedIfChanged(
          savedHours.workerId,
          preHomeEmployerId,
          await deriveHomeEmployerId(savedHours.workerId),
          monthYmd(savedHours.year, savedHours.month),
        );
      }

      await notifyWorkerDataChanged(savedHours.workerId);
      return { data: savedHours, notifications };
    },

    async updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean }): Promise<WorkerHoursResult | undefined> {
      validate.validateOrThrow(data);
      const client = getClient();
      // Pre-state for home-employer change detection: the row's worker and
      // month before the update, plus the worker's derived home employer.
      const [before] = await client
        .select({ workerId: workerHours.workerId, year: workerHours.year, month: workerHours.month })
        .from(workerHours)
        .where(eq(workerHours.id, id));
      const preHomeEmployerId = before ? await deriveHomeEmployerId(before.workerId) : null;
      const [updated] = await client
        .update(workerHours)
        .set(data)
        .where(eq(workerHours.id, id))
        .returning();
      
      if (!updated) {
        return undefined;
      }

      let notifications: LedgerNotification[] = [];

      const payload = {
        hoursId: updated.id,
        workerId: updated.workerId,
        employerId: updated.employerId,
        year: updated.year,
        month: updated.month,
        day: updated.day,
        hours: updated.hours || 0,
        employmentStatusId: updated.employmentStatusId,
        home: updated.home,
      };

      // Emit event for any listeners (future notification plugins, etc.)
      eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
        logger.error("Failed to emit HOURS_SAVED event", {
          service: "worker-hours-storage",
          hoursId: updated.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Execute charge plugins directly (for backwards compatibility with notifications)
      try {
        const { executeChargePlugins, TriggerType } = await import("../plugins/ledger/charge");
        const result = await executeChargePlugins({
          trigger: TriggerType.HOURS_SAVED,
          ...payload,
        });
        notifications = result.notifications;
      } catch (error) {
        logger.error("Failed to execute charge plugins for hours update", {
          service: "worker-hours-storage",
          hoursId: updated.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Home-employer change detection: the effective date is the earlier of
      // the row's old and new months, so listeners rescan every affected period.
      {
        const oldYmd = before ? monthYmd(before.year, before.month) : null;
        const newYmd = monthYmd(updated.year, updated.month);
        emitEmploymentSavedIfChanged(
          updated.workerId,
          preHomeEmployerId,
          await deriveHomeEmployerId(updated.workerId),
          oldYmd && oldYmd < newYmd ? oldYmd : newYmd,
        );
      }

      await notifyWorkerDataChanged(updated.workerId);
      return { data: updated, notifications };
    },

    async deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult> {
      const client = getClient();
      // Pre-state for home-employer change detection: derive the worker's
      // home employer before the row disappears.
      const [before] = await client
        .select({ workerId: workerHours.workerId })
        .from(workerHours)
        .where(eq(workerHours.id, id));
      const preHomeEmployerId = before ? await deriveHomeEmployerId(before.workerId) : null;
      const result = await client
        .delete(workerHours)
        .where(eq(workerHours.id, id))
        .returning();
      
      const deleted = result[0];
      let notifications: LedgerNotification[] = [];

      if (deleted) {
        const payload = {
          hoursId: deleted.id,
          workerId: deleted.workerId,
          employerId: deleted.employerId,
          year: deleted.year,
          month: deleted.month,
          day: deleted.day,
          hours: 0,
          employmentStatusId: deleted.employmentStatusId,
          home: deleted.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: deleted.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../plugins/ledger/charge");
          const pluginResult = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = pluginResult.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours delete", {
            service: "worker-hours-storage",
            hoursId: deleted.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        emitEmploymentSavedIfChanged(
          deleted.workerId,
          preHomeEmployerId,
          await deriveHomeEmployerId(deleted.workerId),
          monthYmd(deleted.year, deleted.month),
        );

        await notifyWorkerDataChanged(deleted.workerId);
      }
      
      return { success: result.length > 0, notifications };
    },

    async upsertWorkerHours(data: { workerId: string; month: number; year: number; day?: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean; jobTitle?: string | null }, options?: { skipHomeEmployerEvent?: boolean }): Promise<WorkerHoursResult> {
      const client = getClient();
      // Skip the pre/post home-employer derivation when the caller guarantees
      // that `home` is not being changed by this upsert (bulk uploads that
      // never touch the home flag). The two DISTINCT ON queries are O(worker
      // history) and amount to 2× the row count in DB round-trips for a run
      // that never triggers `emitEmploymentSavedIfChanged` anyway.
      const preHomeEmployerId = options?.skipHomeEmployerEvent
        ? null
        : await deriveHomeEmployerId(data.workerId);
      const setFields: Record<string, unknown> = {
        employmentStatusId: data.employmentStatusId,
        hours: data.hours,
      };
      if (data.jobTitle !== undefined) {
        setFields.jobTitle = data.jobTitle;
      }
      const [savedHours] = await client
        .insert(workerHours)
        .values({
          ...data,
          day: data.day ?? 1,
        })
        .onConflictDoUpdate({
          target: [workerHours.workerId, workerHours.employerId, workerHours.year, workerHours.month, workerHours.day],
          set: setFields,
        })
        .returning();

      let notifications: LedgerNotification[] = [];

      if (savedHours) {
        const payload = {
          hoursId: savedHours.id,
          workerId: savedHours.workerId,
          employerId: savedHours.employerId,
          year: savedHours.year,
          month: savedHours.month,
          day: savedHours.day,
          hours: savedHours.hours || 0,
          employmentStatusId: savedHours.employmentStatusId,
          home: savedHours.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../plugins/ledger/charge");
          const result = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours save", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (savedHours && !options?.skipHomeEmployerEvent) {
        emitEmploymentSavedIfChanged(
          savedHours.workerId,
          preHomeEmployerId,
          await deriveHomeEmployerId(savedHours.workerId),
          monthYmd(savedHours.year, savedHours.month),
        );
      }

      await notifyWorkerDataChanged(savedHours.workerId);
      return { data: savedHours, notifications };
    },

    async bulkUpsertWorkerHoursMigration(rows: BulkMigrationHoursRow[]): Promise<BulkMigrationHoursPersistedRow[]> {
      // FAIL-CLOSED GUARD (checked before anything else, even empty input):
      // this method exists solely for migration-mode loaders. Refuse to run
      // outside both suppression scopes so the side-effect-free fast path
      // can never leak into interactive code.
      if (!areChargePluginsSuppressed() || !areNotificationsSuppressed()) {
        throw new Error(
          "bulkUpsertWorkerHoursMigration requires charge-plugin AND notification suppression scopes (migration-mode loaders only)",
        );
      }
      if (rows.length === 0) return [];
      // Duplicate composite keys inside one statement would make
      // ON CONFLICT DO UPDATE touch the same row twice (a Postgres error) —
      // and would mean the caller's month aggregation is broken. Fail loudly.
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.workerId}|${r.employerId}|${r.year}|${r.month}`;
        if (seen.has(key)) {
          throw new Error(
            `bulkUpsertWorkerHoursMigration: duplicate month key in batch (${r.year}-${r.month}) — caller aggregation bug`,
          );
        }
        seen.add(key);
      }
      const client = getClient();
      const persisted: BulkMigrationHoursPersistedRow[] = [];
      // Bounded statements: 500 rows × 7 bind params stays far below
      // driver/statement limits while keeping lock spans small. Each chunk
      // is one atomic statement; a crash between chunks leaves earlier
      // chunks persisted — idempotent by the upsert key, so a re-run
      // converges.
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const saved = await client
          .insert(workerHours)
          .values(
            slice.map((r) => ({
              workerId: r.workerId,
              employerId: r.employerId,
              year: r.year,
              month: r.month,
              day: 1,
              employmentStatusId: r.employmentStatusId,
              hours: r.hours,
            })),
          )
          .onConflictDoUpdate({
            target: [workerHours.workerId, workerHours.employerId, workerHours.year, workerHours.month, workerHours.day],
            // MIGRATION-OWNED fields only — id, home, and job_title are
            // staff/system-owned and MUST survive conflict updates.
            set: {
              employmentStatusId: sql`excluded.employment_status_id`,
              hours: sql`excluded.hours`,
            },
          })
          .returning({
            id: workerHours.id,
            workerId: workerHours.workerId,
            employerId: workerHours.employerId,
            year: workerHours.year,
            month: workerHours.month,
            hours: workerHours.hours,
            employmentStatusId: workerHours.employmentStatusId,
            inserted: sql<boolean>`(xmax = 0)`,
          });
        if (saved.length !== slice.length) {
          throw new Error(
            `bulkUpsertWorkerHoursMigration: chunk persisted ${saved.length}/${slice.length} rows — aborting (nothing is silently dropped)`,
          );
        }
        persisted.push(...saved);
      }
      // Aggregate-only operational evidence — deliberately NO per-row audit
      // snapshots (the migration run report + s1_staging.runs carry the
      // evidence; see workerHoursLoggingConfig note).
      logger.info(`Bulk migration hours upsert persisted ${persisted.length} monthly rows`, {
        service: "worker-hours-storage",
        rows: persisted.length,
      });
      return persisted;
    },

    async getWorkerHoursForMonth(workerId: string, employerId: string, year: number, month: number): Promise<Array<{ id: string; day: number }>> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT id, day
        FROM worker_hours
        WHERE worker_id = ${workerId}
          AND employer_id = ${employerId}
          AND year = ${year}
          AND month = ${month}
      `);
      return (result.rows as Array<{ id: string; day: number }>).map(r => ({ id: r.id, day: r.day }));
    },

    async getWorkerHoursForEmployerMonth(employerId: string, year: number, month: number): Promise<Map<string, Array<{ id: string; day: number }>>> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT worker_id, id, day
        FROM worker_hours
        WHERE employer_id = ${employerId}
          AND year = ${year}
          AND month = ${month}
      `);
      const byWorker = new Map<string, Array<{ id: string; day: number }>>();
      for (const row of result.rows as Array<{ worker_id: string; id: string; day: number }>) {
        const existing = byWorker.get(row.worker_id);
        if (existing) {
          existing.push({ id: row.id, day: row.day });
        } else {
          byWorker.set(row.worker_id, [{ id: row.id, day: row.day }]);
        }
      }
      return byWorker;
    },

    async getDistinctWorkerIdsByStatusAndMonths(
      statusIds: string[],
      months: Array<{ year: number; month: number }>,
    ): Promise<string[]> {
      if (statusIds.length === 0 || months.length === 0) return [];
      const client = getClient();
      const monthConditions = months.map(
        ({ year, month }) => sql`(${workerHours.year} = ${year} AND ${workerHours.month} = ${month})`,
      );
      const rows = await client
        .selectDistinct({ workerId: workerHours.workerId })
        .from(workerHours)
        .where(
          and(
            inArray(workerHours.employmentStatusId, statusIds),
            sql`(${sql.join(monthConditions, sql` OR `)})`,
          ),
        );
      return rows.map((r) => r.workerId);
    },

    async getEmployerMonthRowsByWorkerStatusAndMonths(
      workerId: string,
      statusIds: string[],
      months: Array<{ year: number; month: number }>,
    ): Promise<Array<{ year: number; month: number; employerId: string }>> {
      if (statusIds.length === 0 || months.length === 0) return [];
      const client = getClient();
      const monthConditions = months.map(
        ({ year, month }) => sql`(${workerHours.year} = ${year} AND ${workerHours.month} = ${month})`,
      );
      const rows = await client
        .select({
          year: workerHours.year,
          month: workerHours.month,
          employerId: workerHours.employerId,
        })
        .from(workerHours)
        .where(
          and(
            eq(workerHours.workerId, workerId),
            inArray(workerHours.employmentStatusId, statusIds),
            sql`(${sql.join(monthConditions, sql` OR `)})`,
          ),
        );
      return rows as Array<{ year: number; month: number; employerId: string }>;
    },
  };

  return storage;
}

export const workerHoursLoggingConfig: StorageLoggingConfig<WorkerHoursStorage> = {
  module: 'worker-hours',
  // NOTE: bulkUpsertWorkerHoursMigration is intentionally ABSENT here — the
  // migration bulk path records aggregate-safe operational evidence (loader
  // run report + s1_staging.runs) instead of one audit snapshot per migrated
  // monthly row. Unconfigured methods pass through withStorageLogging
  // unlogged.
  methods: {
    createWorkerHours: {
      enabled: true,
      getEntityId: (args, result) => result?.data?.id || 'new hours entry',
      getHostEntityId: (args) => args[0]?.workerId,
      after: async (args, result, storage) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours,
            note: `Hours entry created for ${hoursData.year}/${hoursData.month}`
          }
        };
      }
    },
    updateWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
        return {
          hours: hoursEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursEntry.workerId,
            year: hoursEntry.year,
            month: hoursEntry.month
          }
        };
      },
      after: async (args, result, storage) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours
          }
        };
      }
    },
    deleteWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
        return {
          hours: hoursEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursEntry.workerId,
            year: hoursEntry.year,
            month: hoursEntry.month,
            hours: hoursEntry.hours,
            note: `Hours entry deleted for ${hoursEntry.year}/${hoursEntry.month}`
          }
        };
      }
    },
    upsertWorkerHours: {
      enabled: true,
      getEntityId: (args, result) => result?.data?.id || 'hours entry',
      getHostEntityId: (args) => args[0]?.workerId,
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        const workerId = args[0]?.workerId || result?.data?.workerId;
        const year = args[0]?.year || result?.data?.year;
        const month = args[0]?.month || result?.data?.month;
        return `Worker hours ${operation}d for worker ${workerId} (${year}/${month})`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [existingEntry] = await client
          .select()
          .from(workerHours)
          .where(
            and(
              eq(workerHours.workerId, args[0].workerId),
              eq(workerHours.employerId, args[0].employerId),
              eq(workerHours.year, args[0].year),
              eq(workerHours.month, args[0].month),
              eq(workerHours.day, args[0].day ?? 1)
            )
          );
        
        if (!existingEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, existingEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, existingEntry.employmentStatusId));
        return {
          hours: existingEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: existingEntry.workerId,
            year: existingEntry.year,
            month: existingEntry.month,
            hours: existingEntry.hours,
            operation: 'update'
          }
        };
      },
      after: async (args, result, storage, beforeState) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours,
            operation
          }
        };
      }
    }
  }
};

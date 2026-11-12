
import { getClient } from '../../../../../storage/transaction-context';
import { workerHours } from "@shared/schema";
import { sql } from "drizzle-orm";

import { storageLogger as logger } from "../../../../../logger";

import { areChargePluginsSuppressed, areNotificationsSuppressed } from "../../../../../middleware/request-context";

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
export interface S1WorkerHoursOperations {

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
}

export function createS1WorkerHoursOperations(): S1WorkerHoursOperations {
  return {

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
    }
  };
}

export const s1WorkerHours = createS1WorkerHoursOperations();

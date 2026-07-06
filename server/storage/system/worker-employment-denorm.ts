import { getClient } from '../transaction-context';
import { workerEmploymentDenorm, type WorkerEmploymentDenorm } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * One employment row to denormalize for a worker: their latest employment with a
 * single employer, derived from hours history (`worker_hours`).
 */
export interface WorkerEmploymentRow {
  employerId: string;
  home: boolean;
  jobTitle: string | null;
}

/**
 * Storage for the `worker_employment_denorm` payload table — the denormalized set
 * of a worker's current employment (one row per employer's latest employment).
 * This is the SOLE writer of the table; rows are maintained exclusively by the
 * `worker_employment` denorm plugin via {@link replaceForWorker}.
 */
export interface WorkerEmploymentDenormStorage {
  /** All denorm rows for a worker. */
  getByWorker(workerId: string): Promise<WorkerEmploymentDenorm[]>;
  /**
   * Replace the full set of current employment for a worker: delete the existing
   * rows and insert one row per employer. Caller is responsible for wrapping this
   * in a transaction together with the matching `denorm` status upsert so the two
   * stay consistent.
   */
  replaceForWorker(workerId: string, denormId: string, rows: WorkerEmploymentRow[]): Promise<void>;
}

export function createWorkerEmploymentDenormStorage(): WorkerEmploymentDenormStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerEmploymentDenorm[]> {
      const client = getClient();
      return client
        .select()
        .from(workerEmploymentDenorm)
        .where(eq(workerEmploymentDenorm.workerId, workerId));
    },

    async replaceForWorker(workerId: string, denormId: string, rows: WorkerEmploymentRow[]): Promise<void> {
      const client = getClient();
      await client.delete(workerEmploymentDenorm).where(eq(workerEmploymentDenorm.workerId, workerId));
      // De-dupe defensively by employer: the unique (worker_id, employer_id)
      // index would reject duplicate employer ids. Keep the first occurrence.
      const seen = new Set<string>();
      const uniqueRows = rows.filter((r) => {
        if (seen.has(r.employerId)) return false;
        seen.add(r.employerId);
        return true;
      });
      if (uniqueRows.length > 0) {
        await client.insert(workerEmploymentDenorm).values(
          uniqueRows.map((r) => ({
            denormId,
            workerId,
            employerId: r.employerId,
            home: r.home,
            jobTitle: r.jobTitle,
          })),
        );
      }
    },
  };
}

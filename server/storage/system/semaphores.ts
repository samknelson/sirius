import type { PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { pool } from "../db";
import { getCurrentTransaction } from "../transaction-context";
import type { SemaphoreStatusSnapshot } from "@shared/schema/system/semaphores-schema";

export const SEMAPHORE_OPERATION_MS = 5_000;
export const SEMAPHORE_LEASE_MS = 30_000;
export class SemaphoreLost extends Error {
  constructor() {
    super("Semaphore ownership lost. Partial work may still be finishing; results are uncertain. Nothing was automatically retried.");
  }
}
export interface SemaphoreIdentity { key: string; owner: string; token: string }

/**
 * Fence the ACTUAL ambient business transaction. No maintenance exception or
 * whole-operation deadline: only coordination lock acquisition is bounded.
 * The row stays locked through the caller's commit/rollback, excluding claim.
 */
export async function guardSemaphoreTransaction<T>(
  id: SemaphoreIdentity, assertOwned: () => void, work: () => Promise<T>,
): Promise<T> {
  const tx = getCurrentTransaction();
  if (!tx) throw new Error("Semaphore mutation fencing requires an ambient transaction");
  assertOwned();
  const previous = await tx.execute(sql`SELECT current_setting('lock_timeout') AS timeout`);
  await tx.execute(sql`SELECT set_config('lock_timeout', '2s', true)`);
  try {
    await tx.execute(sql`SELECT key FROM semaphores WHERE key = ${id.key} FOR UPDATE`);
  } catch {
    throw new SemaphoreLost();
  }
  await tx.execute(sql`SELECT set_config('lock_timeout', ${String(previous.rows[0].timeout)}, true)`);
  const check = async () => {
    assertOwned();
    const current = await tx.execute(sql`SELECT key FROM semaphores
      WHERE key = ${id.key} AND owner_process_id = ${id.owner}
      AND ownership_token = ${id.token} AND expires_at > clock_timestamp()`);
    if (!current.rowCount) throw new SemaphoreLost();
    assertOwned();
  };
  await check();
  const result = await work();
  await check();
  return result;
}

/**
 * Coordination/history only. No ambient transaction, audit wrapper, or reserved
 * connection. The entire checkout/transaction has a deadline, not just each SQL.
 * Destroy on ambiguity so a timed-out transaction cannot later commit.
 */
async function transaction<T>(work: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  let client: PoolClient | undefined;
  let expired = false;
  let released = false;
  const onError = () => {}; // retain on destroyed clients for late driver errors
  const destroy = () => {
    if (client && !released) { released = true; client.release(true); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = () => readOnly ? new Error("Semaphore status read timed out") : new SemaphoreLost();
  const operation = (async () => {
    client = await pool.connect();
    client.on("error", onError);
    if (expired) { destroy(); throw timeoutError(); }
    try {
      await client.query("BEGIN");
      // Narrow maintenance exception: semaphore and guarded run-history only.
      await client.query(readOnly ? "SET LOCAL transaction_read_only = on" : "SET LOCAL transaction_read_only = off");
      await client.query("SET LOCAL statement_timeout = '4s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const result = await work(client);
      if (expired) throw timeoutError();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      destroy();
      throw error;
    } finally {
      if (!released) {
        released = true;
        client.removeListener("error", onError);
        client.release();
      }
    }
  })();
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; destroy(); reject(timeoutError()); }, SEMAPHORE_OPERATION_MS);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const values = (id: SemaphoreIdentity) => [id.key, id.owner, id.token];
// Only for conditional interruption of cron history after lost ownership.
export const semaphoreHistoryTransaction = transaction;
export const SEMAPHORE_STATUS_LIMIT = 200;
export const semaphoreStorage = {
  /** Independent, bounded read; telemetry is descriptive, never lease authority. */
  status(): Promise<SemaphoreStatusSnapshot> {
    return transaction(async client => {
      type Row = {
        observed_at: Date; key: string | null; owner_process_id: string | null;
        expires_at: Date | null; owner_name: string | null; telemetry_present: boolean;
        state: "held" | "expired" | "unowned";
      };
      const { rows } = await client.query<Row>(`
        WITH observation AS MATERIALIZED (SELECT clock_timestamp() AS observed_at),
        resources AS (
          SELECT key, owner_process_id, expires_at FROM semaphores
          ORDER BY (key = 'cron:scheduler') DESC, key
          LIMIT $1
        )
        SELECT observation.observed_at, resources.key, resources.owner_process_id,
          resources.expires_at, processes.name AS owner_name,
          processes.id IS NOT NULL AS telemetry_present,
          CASE WHEN resources.owner_process_id IS NULL THEN 'unowned'
            WHEN resources.expires_at <= observation.observed_at THEN 'expired'
            ELSE 'held' END AS state
        FROM observation LEFT JOIN resources ON true
        LEFT JOIN processes ON processes.id = resources.owner_process_id
        ORDER BY (resources.key = 'cron:scheduler') DESC, resources.key
      `, [SEMAPHORE_STATUS_LIMIT + 1]);
      return {
        observedAt: rows[0].observed_at,
        truncated: rows.length > SEMAPHORE_STATUS_LIMIT,
        entries: rows.filter(row => row.key !== null).slice(0, SEMAPHORE_STATUS_LIMIT).map(row => ({
          key: row.key!, ownerProcessId: row.owner_process_id, expiresAt: row.expires_at,
          ownerName: row.owner_name, ownerTelemetry: row.telemetry_present ? "present" : "missing",
          state: row.state,
        })),
      };
    }, true);
  },
  claim(id: SemaphoreIdentity): Promise<boolean> {
    return transaction(async client => {
      const result = await client.query(`
        INSERT INTO semaphores (key, owner_process_id, ownership_token, expires_at)
        VALUES ($1, $2, $3, clock_timestamp() + interval '30 seconds')
        ON CONFLICT (key) DO UPDATE SET owner_process_id = EXCLUDED.owner_process_id,
          ownership_token = EXCLUDED.ownership_token, expires_at = clock_timestamp() + interval '30 seconds'
        WHERE semaphores.ownership_token IS NULL OR semaphores.expires_at <= clock_timestamp()
        RETURNING key`, values(id));
      return result.rowCount === 1;
    });
  },
  renew(id: SemaphoreIdentity): Promise<boolean> {
    return transaction(async client => {
      const result = await client.query(`UPDATE semaphores SET expires_at = clock_timestamp() + interval '30 seconds'
        WHERE key = $1 AND owner_process_id = $2 AND ownership_token = $3
        AND expires_at > clock_timestamp() RETURNING key`, values(id));
      return result.rowCount === 1;
    });
  },
  release(id: SemaphoreIdentity): Promise<void> {
    return transaction(async client => {
      await client.query(`UPDATE semaphores SET owner_process_id = NULL, ownership_token = NULL, expires_at = NULL
        WHERE key = $1 AND owner_process_id = $2 AND ownership_token = $3`, values(id));
    });
  },
  guarded<T>(id: SemaphoreIdentity, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return transaction(async client => {
      // Lock first, then check the database clock AFTER any wait.
      await client.query("SELECT key FROM semaphores WHERE key = $1 FOR UPDATE", [id.key]);
      const check = async () => {
        const result = await client.query(`SELECT key FROM semaphores
          WHERE key = $1 AND owner_process_id = $2 AND ownership_token = $3
          AND expires_at > clock_timestamp()`, values(id));
        if (!result.rowCount) throw new SemaphoreLost();
      };
      await check();
      const result = await work(client);
      await check();
      return result;
    });
  },
};

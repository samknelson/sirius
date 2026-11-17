import type { PoolClient } from "pg";
import { pool } from "../db";

export const SEMAPHORE_OPERATION_MS = 5_000;
export const SEMAPHORE_LEASE_MS = 30_000;
export class SemaphoreLost extends Error {
  constructor() {
    super("Cron semaphore ownership lost. Partial work may still be finishing; results are uncertain. Nothing was automatically retried.");
  }
}
export interface SemaphoreIdentity { key: string; owner: string; token: string }

/**
 * Coordination/history only. No ambient transaction, audit wrapper, or reserved
 * connection. The entire checkout/transaction has a deadline, not just each SQL.
 * Destroy on ambiguity so a timed-out transaction cannot later commit.
 */
async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  let expired = false;
  let released = false;
  const onError = () => {}; // retain on destroyed clients for late driver errors
  const destroy = () => {
    if (client && !released) { released = true; client.release(true); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = (async () => {
    client = await pool.connect();
    client.on("error", onError);
    if (expired) { destroy(); throw new SemaphoreLost(); }
    try {
      await client.query("BEGIN");
      // Narrow maintenance exception: semaphore and cron history writes only.
      await client.query("SET LOCAL transaction_read_only = off");
      await client.query("SET LOCAL statement_timeout = '4s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const result = await work(client);
      if (expired) throw new SemaphoreLost();
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
      timer = setTimeout(() => { expired = true; destroy(); reject(new SemaphoreLost()); }, SEMAPHORE_OPERATION_MS);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const values = (id: SemaphoreIdentity) => [id.key, id.owner, id.token];
// Only for conditional interruption of cron history after lost ownership.
export const semaphoreHistoryTransaction = transaction;
export const semaphoreStorage = {
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

import type { Pool, PoolClient } from "pg";

/** Standalone-process guard: never let a driver error escape to console. */
export function fileLoaderLock(pool: Pool) {
  let lost = false;
  let client: PoolClient | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: Promise<void> | undefined;
  const onError = () => { lost = true; };
  // The shared web pool logs raw driver messages. This CLI owns its pool and
  // replaces that policy for its entire lifetime, including shutdown.
  pool.removeAllListeners("error");
  pool.on("error", onError);
  const check = () => {
    if (lost) throw new Error("database_connection_lost");
  };
  return {
    get lost() { return lost; },
    check,
    async acquire() {
      client = await pool.connect();
      client.on("error", onError);
      const result = await client.query("SELECT pg_try_advisory_lock(hashtext('s1-files')) AS locked");
      check();
      if (!result.rows[0]?.locked) throw new Error("file_loader_already_running");
      timer = setInterval(() => {
        if (lost || heartbeat) return;
        heartbeat = client!.query("SELECT 1").then(() => {}, onError)
          .finally(() => { heartbeat = undefined; });
      }, 60_000);
    },
    async release() {
      if (timer) clearInterval(timer);
      await heartbeat;
      if (!client) return;
      try {
        if (!lost) await client.query("SELECT pg_advisory_unlock(hashtext('s1-files'))");
      } catch { onError(); }
      finally {
        // Destroy even a healthy dedicated client; never return a potentially
        // locked or disconnected session to the pool.
        client.release(true);
        client = undefined;
      }
    },
  };
}

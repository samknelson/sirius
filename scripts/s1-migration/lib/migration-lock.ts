const MIGRATION_LOCK_KEY = 727001;

interface LockClient {
  query(text: string): Promise<{ rows: Array<{ got?: boolean }> }>;
  release(): void;
}

interface LockPool {
  connect(): Promise<LockClient>;
}

/**
 * Standalone production seeds serialize on the migration advisory lock.
 * bootstrap-target keeps that lock in its parent session and marks child
 * processes so they do not deadlock trying to acquire the same key.
 */
export async function acquireMigrationSeedLock(pool: LockPool): Promise<LockClient | null> {
  if (process.env.S1_BOOTSTRAP_LOCK_HELD === "1") return null;
  const client = await pool.connect();
  const [{ got }] = (await client.query(
    `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS got`,
  )).rows;
  if (!got) {
    client.release();
    throw new Error("another migration process holds the advisory lock on this target");
  }
  return client;
}

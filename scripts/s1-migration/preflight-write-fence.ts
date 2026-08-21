/**
 * Hold the real S1 app-write fence briefly so an operator can verify that the
 * deployed web image keeps reads online and rejects mutations with a 503.
 *
 * Run only as a migration-image ECS one-off:
 *   npx tsx scripts/s1-migration/preflight-write-fence.ts --seconds 120
 *
 * This script changes no application rows. It takes the migration advisory
 * lock so it cannot overlap a sync/bootstrap/seed command.
 */
import { pool as pgPool } from "../../server/storage/db";
import {
  acquireExclusiveAppWriteFence,
  endAppWriteFencePool,
  type AppWriteFenceLease,
} from "../../server/services/s1-write-fence";

const MIGRATION_LOCK_KEY = 727001;

function holdSeconds(): number {
  const index = process.argv.indexOf("--seconds");
  const parsed = Number(index >= 0 ? process.argv[index + 1] : 120);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(15, Math.min(600, Math.floor(parsed)));
}

async function waitForTimeoutOrSignal(ms: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    const finish = (signal: string) => {
      clearTimeout(timer);
      resolve(signal);
    };
    process.once("SIGTERM", () => finish("SIGTERM"));
    process.once("SIGINT", () => finish("SIGINT"));
  });
}

async function main(): Promise<void> {
  const seconds = holdSeconds();
  const lockClient = await pgPool.connect();
  let lease: AppWriteFenceLease | null = null;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [MIGRATION_LOCK_KEY],
    );
    if (lock.rows[0]?.acquired !== true) {
      throw new Error("another migration command owns the advisory lock; preflight refused");
    }
    console.log("[fence-preflight] migration lock acquired; waiting for in-flight app mutations");
    lease = await acquireExclusiveAppWriteFence();
    console.log(
      `[fence-preflight] READY for ${seconds}s — verify GET remains online and POST returns retryable 503`,
    );
    const completion = await waitForTimeoutOrSignal(seconds * 1_000);
    console.log(`[fence-preflight] hold complete (${completion}); releasing`);
  } finally {
    await lease?.release();
    await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]).catch(() => undefined);
    lockClient.release(true);
    await endAppWriteFencePool();
    await pgPool.end();
  }
}

main().catch((error) => {
  console.error(`[fence-preflight] FAIL: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  process.exitCode = 1;
});
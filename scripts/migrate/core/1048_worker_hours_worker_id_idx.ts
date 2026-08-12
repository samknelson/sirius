import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Adds worker_hours_worker_id_idx on worker_hours (worker_id) to speed up
 * per-worker hours lookups (worker detail, charge plugins). Idempotent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS worker_hours_worker_id_idx ON worker_hours (worker_id)
  `);
  logger.info("worker_hours_worker_id_idx ready", { service: "migration-1048" });
}

registerMigration({
  version: 1048,
  name: "worker_hours_worker_id_idx",
  description: "Create worker_hours_worker_id_idx on worker_hours (worker_id) for per-worker hours lookups",
  up,
});

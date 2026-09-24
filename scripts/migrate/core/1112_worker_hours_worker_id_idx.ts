import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS worker_hours_worker_id_idx ON worker_hours (worker_id)
  `);
  logger.info("worker_hours_worker_id_idx ready", { service: "migration-1112" });
}

registerMigration({
  version: 1112,
  name: "worker_hours_worker_id_idx",
  description: "Create the worker_id index for per-worker hours lookups",
  up,
});
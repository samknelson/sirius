import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Add a per-benefit `show_on_worker_list` flag to `trust_benefits`.
 *
 * Some benefits (e.g. supplemental ones) do not need to clutter the benefit
 * column of the worker list. This boolean lets an admin hide an individual
 * benefit from that column while keeping it everywhere else. Defaults to true
 * so existing benefits keep showing exactly as before.
 *
 * Idempotent via ADD COLUMN IF NOT EXISTS (migrations are not wrapped in a
 * single transaction, so this self-heals on a partial re-run).
 *
 * Renumbered 1103 → 1131 (above the max existing core version) so the runner
 * actually replays it — a version <= the stored counter would be silently
 * skipped.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE trust_benefits ADD COLUMN IF NOT EXISTS show_on_worker_list boolean NOT NULL DEFAULT true`,
  );
  logger.info("Ensured trust_benefits.show_on_worker_list column", {
    service: "migration-1131",
  });
}

const migration: Migration = {
  version: 1131,
  name: "add_trust_benefit_show_on_worker_list",
  description:
    "Add a per-benefit `show_on_worker_list` boolean column to trust_benefits (default true) so admins can hide individual benefits from the worker list benefit column.",
  up,
};

registerMigration(migration);

export default migration;

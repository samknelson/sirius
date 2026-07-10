import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.elections";

/**
 * Add the `enrollment_type` discriminator to `worker_trust_elections`.
 * Every posted enrollment records which of the three enrollment types it
 * is (`first_time` / `life_event` / `open_enrollment`) so downstream queue
 * and per-type notification work can filter on it.
 *
 * The column is nullable: manually-created elections (the "New Election"
 * dialog) legitimately have no enrollment type. Every existing row predates
 * the concept and came from the first-time benefit-election wizard (or a
 * manual create that is equivalent to a first-time enrollment), so the
 * one-time backfill stamps them `first_time`.
 *
 * Owned by the `trust.elections` component. On a fresh enable the
 * schema-push already creates the table WITH `enrollment_type` (it is in the
 * elections schema module), so both statements are no-ops there.
 *
 * Idempotent: the column uses IF NOT EXISTS and the backfill only touches
 * rows still NULL, so a re-run never overwrites a value set after this ran.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE worker_trust_elections ADD COLUMN IF NOT EXISTS enrollment_type varchar`,
  );
  const backfilled = await db.execute(
    sql`UPDATE worker_trust_elections SET enrollment_type = 'first_time' WHERE enrollment_type IS NULL`,
  );
  logger.info("Added worker_trust_elections.enrollment_type + backfilled existing rows to first_time", {
    service: "migration-trust.elections-001",
    backfilled: backfilled.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1,
  name: "add_enrollment_type",
  description:
    "Add the nullable enrollment_type discriminator to worker_trust_elections and backfill existing rows to 'first_time'. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

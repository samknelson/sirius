import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1144";

/**
 * A person's own time zone: `users.timezone`.
 *
 * Nullable with no default, and deliberately so. Null is not "use the system
 * zone" — it is "this person has made no choice", which resolves to their own
 * runtime's zone when site policy allows personal zones. Backfilling every
 * existing row with the system zone would erase that distinction and silently
 * opt the whole user base into site time, which is a policy decision the site
 * settings own, not a migration.
 *
 * Display only: nothing stored anywhere is written in this zone.
 *
 * Idempotent: the column is added only if absent.
 */
async function up(): Promise<void> {
  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'timezone'
    ) AS exists
  `);
  const hasColumn = colCheck.rows?.[0]?.exists === true || colCheck.rows?.[0]?.exists === "t";
  if (!hasColumn) {
    await db.execute(sql`ALTER TABLE users ADD COLUMN timezone varchar`);
    logger.info("Added timezone column to users", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1144,
  name: "add_users_timezone",
  description:
    "Add the nullable users.timezone column holding a person's own IANA time zone for display. Null means no explicit choice (which resolves to the viewer's own runtime zone when site policy allows personal zones), NOT the system zone — so existing rows are deliberately left null rather than backfilled. The column never affects what is stored: every timestamp column remains a wall-clock reading in the server's system zone.",
  up,
};

registerMigration(migration);

export default migration;

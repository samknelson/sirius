import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const columnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employers'
        AND column_name = 'business_calendar_id'
    ) AS exists
  `);
  const exists = columnCheck.rows[0]?.exists === true || columnCheck.rows[0]?.exists === 't';
  if (exists) {
    logger.info("employers.business_calendar_id already exists, skipping", { service: "migration-1050" });
    return;
  }

  await db.execute(sql`
    ALTER TABLE employers
      ADD COLUMN business_calendar_id varchar,
      ADD CONSTRAINT employers_business_calendar_id_fkey
        FOREIGN KEY (business_calendar_id) REFERENCES business_calendars(id) ON DELETE SET NULL
  `);

  logger.info("Added employers.business_calendar_id with FK to business_calendars", { service: "migration-1050" });
}

const migration: Migration = {
  version: 1050,
  name: "add_employer_business_calendar",
  description: "Add nullable employers.business_calendar_id FK to business_calendars (ON DELETE SET NULL)",
  up,
};

registerMigration(migration);

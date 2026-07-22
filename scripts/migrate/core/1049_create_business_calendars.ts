import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'business_calendars'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (exists) {
    logger.info("business_calendars table already exists, skipping", { service: "migration-1049" });
    return;
  }

  await db.execute(sql`
    CREATE TABLE business_calendars (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      sirius_id varchar UNIQUE,
      name text NOT NULL,
      description text,
      sources text[] NOT NULL DEFAULT '{}'::text[],
      data jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await db.execute(sql`
    CREATE TABLE business_calendar_manual_byday (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_id varchar NOT NULL,
      ymd varchar NOT NULL,
      CONSTRAINT bcal_manual_byday_calendar_id_fkey
        FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE CASCADE,
      CONSTRAINT bcal_manual_byday_calendar_id_ymd_unique UNIQUE (calendar_id, ymd)
    )
  `);

  await db.execute(sql`
    CREATE TABLE business_calendar_manual_vacation (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_id varchar NOT NULL,
      start_ymd varchar NOT NULL,
      end_ymd varchar NOT NULL,
      CONSTRAINT bcal_manual_vacation_calendar_id_fkey
        FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE CASCADE,
      CONSTRAINT bcal_manual_vacation_range_check CHECK (start_ymd <= end_ymd)
    )
  `);

  await db.execute(sql`
    CREATE TABLE business_calendar_manual_open (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_id varchar NOT NULL,
      ymd varchar NOT NULL,
      CONSTRAINT bcal_manual_open_calendar_id_fkey
        FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE CASCADE,
      CONSTRAINT bcal_manual_open_calendar_id_ymd_unique UNIQUE (calendar_id, ymd)
    )
  `);

  logger.info("Created business_calendars and manual byday/vacation/open tables", {
    service: "migration-1049",
  });
}

const migration: Migration = {
  version: 1049,
  name: "create_business_calendars",
  description:
    "Create core business calendar tables: business_calendars plus manual byday (closed days), vacation (closed ranges), and open (forced-open override) tables",
  up,
};

registerMigration(migration);

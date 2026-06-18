import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='edls_sheets') AS has_edls,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='facilities') AS has_facilities
  `);
  const row: { has_edls?: boolean | string; has_facilities?: boolean | string } = tableCheck.rows[0] ?? {};
  const hasEdls = row.has_edls === true || row.has_edls === 't';
  const hasFacilities = row.has_facilities === true || row.has_facilities === 't';
  if (!hasEdls || !hasFacilities) {
    logger.info("Required tables missing (edls_sheets or facilities); component not enabled, skipping", {
      service: "migration-1007",
      hasEdls,
      hasFacilities,
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'edls_sheets' AND column_name = 'facility_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    logger.info("edls_sheets.facility_id column missing; nothing to constrain, skipping", {
      service: "migration-1007",
    });
    return;
  }

  const fkCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'edls_sheets'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'facilities'::regclass
        AND a.attname = 'facility_id'
    ) AS exists
  `);
  const hasFk = fkCheck.rows[0]?.exists === true || fkCheck.rows[0]?.exists === 't';
  if (hasFk) {
    logger.info("edls_sheets.facility_id -> facilities FK already exists, skipping", {
      service: "migration-1007",
    });
    return;
  }

  // Null out any orphaned references so adding the constraint cannot fail.
  // This matches the schema's ON DELETE SET NULL semantics.
  await db.execute(sql`
    UPDATE edls_sheets s
    SET facility_id = NULL
    WHERE s.facility_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM facilities f WHERE f.id = s.facility_id)
  `);

  await db.execute(sql`
    ALTER TABLE edls_sheets
    ADD CONSTRAINT edls_sheets_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL
  `);

  logger.info("Added facility_id -> facilities FK to edls_sheets", {
    service: "migration-1007",
  });
}

const migration: Migration = {
  version: 1007,
  name: "add_edls_sheet_facility_fk",
  up,
};

registerMigration(migration);

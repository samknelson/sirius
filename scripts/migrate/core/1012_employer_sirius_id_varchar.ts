import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'employers'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("employers table missing; skipping", { service: "migration-1012" });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'employers' AND column_name = 'sirius_id'
  `);
  const dataType = (colCheck.rows[0] as any)?.data_type as string | undefined;
  if (!dataType) {
    logger.info("employers.sirius_id column missing; skipping", { service: "migration-1012" });
    return;
  }

  // Type conversion is the only step that depends on the current type. The
  // remaining final-state steps below are unconditional, idempotent no-ops when
  // already satisfied, so a partially-applied migration converges on re-run.
  if (dataType !== "character varying") {
    // Convert integer -> varchar, preserving existing values as text so the
    // unique constraint is not violated.
    await db.execute(
      sql`ALTER TABLE employers ALTER COLUMN sirius_id TYPE varchar USING sirius_id::varchar`,
    );
    logger.info("Converted employers.sirius_id type to varchar", {
      service: "migration-1012",
    });
  }

  // Enforce final state unconditionally (each is a safe no-op when already met):
  // drop the serial default, make the column optional, and remove the orphaned
  // sequence created by the original serial column.
  await db.execute(sql`ALTER TABLE employers ALTER COLUMN sirius_id DROP DEFAULT`);
  await db.execute(sql`ALTER TABLE employers ALTER COLUMN sirius_id DROP NOT NULL`);
  await db.execute(sql`DROP SEQUENCE IF EXISTS employers_sirius_id_seq`);

  // Ensure a unique constraint covers sirius_id (it should persist through the
  // type change, but guard for safety / idempotency).
  const anyUnique = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'employers'::regclass AND contype = 'u'
        AND conkey = (
          SELECT array_agg(attnum) FROM pg_attribute
          WHERE attrelid = 'employers'::regclass AND attname = 'sirius_id'
        )
    ) AS exists
  `);
  const hasAnyUnique = anyUnique.rows[0]?.exists === true || anyUnique.rows[0]?.exists === "t";
  if (!hasAnyUnique) {
    await db.execute(sql`
      ALTER TABLE employers
      ADD CONSTRAINT employers_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint employers_sirius_id_unique", {
      service: "migration-1012",
    });
  }
}

const migration: Migration = {
  version: 1012,
  name: "employer_sirius_id_varchar",
  description: "Convert employers.sirius_id from serial integer to optional unique varchar",
  up,
};

registerMigration(migration);

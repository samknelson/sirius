import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_trust_benefit_type'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("options_trust_benefit_type table missing; skipping", {
      service: "migration-1009",
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'options_trust_benefit_type' AND column_name = 'sirius_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    await db.execute(sql`
      ALTER TABLE options_trust_benefit_type ADD COLUMN sirius_id varchar(255)
    `);
    logger.info("Added sirius_id column to options_trust_benefit_type", {
      service: "migration-1009",
    });
  }

  const constraintCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'options_trust_benefit_type'::regclass
        AND conname = 'options_trust_benefit_type_sirius_id_unique'
    ) AS exists
  `);
  const hasConstraint = constraintCheck.rows[0]?.exists === true || constraintCheck.rows[0]?.exists === 't';
  if (!hasConstraint) {
    await db.execute(sql`
      ALTER TABLE options_trust_benefit_type
      ADD CONSTRAINT options_trust_benefit_type_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint options_trust_benefit_type_sirius_id_unique", {
      service: "migration-1009",
    });
  }
}

const migration: Migration = {
  version: 1009,
  name: "add_benefit_type_sirius_id",
  description: "Add optional unique sirius_id column to options_trust_benefit_type",
  up,
};

registerMigration(migration);

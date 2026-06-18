import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'trust_benefits'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("trust_benefits table missing; skipping", {
      service: "migration-1008",
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'trust_benefits' AND column_name = 'sirius_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    await db.execute(sql`
      ALTER TABLE trust_benefits ADD COLUMN sirius_id varchar
    `);
    logger.info("Added sirius_id column to trust_benefits", {
      service: "migration-1008",
    });
  }

  const constraintCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'trust_benefits'::regclass
        AND conname = 'trust_benefits_sirius_id_unique'
    ) AS exists
  `);
  const hasConstraint = constraintCheck.rows[0]?.exists === true || constraintCheck.rows[0]?.exists === 't';
  if (!hasConstraint) {
    await db.execute(sql`
      ALTER TABLE trust_benefits
      ADD CONSTRAINT trust_benefits_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint trust_benefits_sirius_id_unique", {
      service: "migration-1008",
    });
  }
}

const migration: Migration = {
  version: 1008,
  name: "add_trust_benefit_sirius_id",
  description: "Add optional unique sirius_id column to trust_benefits",
  up,
};

registerMigration(migration);

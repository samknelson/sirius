import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_grievance_remedies'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("options_grievance_remedies table already exists, skipping creation", {
      service: "migration-grievance-015",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE options_grievance_remedies (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL UNIQUE,
      description text,
      sirius_id varchar UNIQUE,
      sequence integer NOT NULL DEFAULT 0,
      data jsonb
    )
  `);

  logger.info("Created options_grievance_remedies table", {
    service: "migration-grievance-015",
  });
}

const migration: Migration = {
  version: 15,
  name: "create_options_grievance_remedies",
  description:
    "Create the options_grievance_remedies table owned by the grievance component. Standard unified-options shape (name, description, sirius_id, sequence, data). Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

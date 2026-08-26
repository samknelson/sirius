import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

/**
 * Create `options_grievance_denial_reason` — configurable denial reasons
 * for the S2 appeals intake flow. Each appeal grievance stores the selected
 * denial reason id in `grievances.data.appealMeta.denialReasonId`.
 *
 * Shape mirrors `options_grievance_status` (name unique, description, sirius_id
 * unique, sequence for ordering, data jsonb). Idempotent: skips create when
 * the table already exists.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_grievance_denial_reason'
    ) AS exists
  `);
  const exists =
    result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";

  if (exists) {
    logger.info("options_grievance_denial_reason already exists, skipping create", {
      service: "migration-grievance-030",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE options_grievance_denial_reason (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      description text,
      sirius_id varchar UNIQUE,
      sequence integer NOT NULL DEFAULT 0,
      data jsonb,
      CONSTRAINT options_grievance_denial_reason_name_unique UNIQUE (name)
    )
  `);

  logger.info("Created options_grievance_denial_reason table", {
    service: "migration-grievance-030",
  });
}

const migration: Migration = {
  version: 30,
  name: "create_options_grievance_denial_reason",
  description:
    "Create options_grievance_denial_reason — configurable denial-reason options for S2 appeal grievances (name unique, description, sirius_id unique, sequence, data jsonb). Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

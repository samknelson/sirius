import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.benefits";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'trust_wmb_events'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("trust_wmb_events table already exists, skipping creation", {
      service: "migration-trust.benefits-002",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE trust_wmb_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id varchar NOT NULL,
      year integer NOT NULL,
      month integer NOT NULL,
      benefit_id varchar NOT NULL,
      event_type varchar NOT NULL,
      data jsonb,
      CONSTRAINT trust_wmb_events_worker_id_workers_id_fk
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
      CONSTRAINT trust_wmb_events_benefit_id_trust_benefits_id_fk
        FOREIGN KEY (benefit_id) REFERENCES trust_benefits(id) ON DELETE CASCADE,
      CONSTRAINT trust_wmb_events_worker_year_month_benefit_type_unique
        UNIQUE (worker_id, year, month, benefit_id, event_type)
    )
  `);

  logger.info("Created trust_wmb_events table", {
    service: "migration-trust.benefits-002",
  });
}

const migration: Migration = {
  version: 2,
  name: "create_trust_wmb_events",
  description: "Create the trust_wmb_events table (worker-month-benefit start/restart/terminate lifecycle events) owned by the trust.benefits component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "worker.aat";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
}

async function up(): Promise<void> {
  if (await tableExists("worker_aat")) {
    logger.info("worker_aat table already exists, skipping creation", {
      service: "migration-worker.aat-001",
    });
    return;
  }

  // Shape must mirror `shared/schema/worker/aat/schema.ts` exactly, including
  // whether uniqueness is a CONSTRAINT or an INDEX: the boot drift gate
  // reflects those as separate categories, and the Drizzle declaration uses
  // named UNIQUE constraints.
  await db.execute(sql`
    CREATE TABLE worker_aat (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Unnamed FK on purpose: the component enable path pushes the Drizzle
      -- declaration and lets Postgres name it worker_aat_worker_id_fkey, so
      -- naming it here would leave migrated deployments inconsistent with
      -- freshly enabled ones.
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      access_code varchar,
      access_uuid varchar,
      CONSTRAINT worker_aat_worker_id_unique UNIQUE (worker_id),
      CONSTRAINT worker_aat_access_uuid_unique UNIQUE (access_uuid)
    )
  `);

  logger.info("Created worker_aat table", {
    service: "migration-worker.aat-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_worker_aat",
  description: "Create the worker_aat table owned by the worker.aat component: at most one row per worker (named unique on worker_id, cascading FK), an optional non-unique access_code and an optional uniquely-constrained access_uuid. Idempotent: skips creation if the table already exists (the enable flow / self-heal creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Create the grievance record table and its two subsidiary link tables,
 * all owned by the grievance component.
 *
 * - grievances: the core record (complaint/remedy free text, required
 *   status_id/category_id FKs into the grievance options tables). Both FKs
 *   are ON DELETE RESTRICT so an option still referenced by a grievance
 *   cannot be deleted.
 * - grievance_workers / grievance_employers: many-to-many link tables tying
 *   grievances to workers and employers respectively. Each FK is ON DELETE
 *   RESTRICT, and each table is unique on its (entity_id, grievance_id) pair.
 *
 * Idempotent: each table is created only if absent (the enable flow creates
 * them via component schema push first).
 */
async function up(): Promise<void> {
  if (!(await tableExists("grievances"))) {
    await db.execute(sql`
      CREATE TABLE grievances (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        complaint text,
        remedy text,
        status_id varchar NOT NULL REFERENCES options_grievance_status(id) ON DELETE RESTRICT,
        category_id varchar NOT NULL REFERENCES options_grievance_category(id) ON DELETE RESTRICT,
        data jsonb
      )
    `);
    logger.info("Created grievances table", { service: "migration-grievance-003" });
  } else {
    logger.info("grievances table already exists, skipping", {
      service: "migration-grievance-003",
    });
  }

  if (!(await tableExists("grievance_workers"))) {
    await db.execute(sql`
      CREATE TABLE grievance_workers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE RESTRICT,
        data jsonb
      )
    `);
    await db.execute(
      sql`CREATE UNIQUE INDEX grievance_workers_worker_grievance_unique ON grievance_workers (worker_id, grievance_id)`,
    );
    logger.info("Created grievance_workers table", { service: "migration-grievance-003" });
  } else {
    logger.info("grievance_workers table already exists, skipping", {
      service: "migration-grievance-003",
    });
  }

  if (!(await tableExists("grievance_employers"))) {
    await db.execute(sql`
      CREATE TABLE grievance_employers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE RESTRICT,
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE RESTRICT,
        data jsonb
      )
    `);
    await db.execute(
      sql`CREATE UNIQUE INDEX grievance_employers_employer_grievance_unique ON grievance_employers (employer_id, grievance_id)`,
    );
    logger.info("Created grievance_employers table", { service: "migration-grievance-003" });
  } else {
    logger.info("grievance_employers table already exists, skipping", {
      service: "migration-grievance-003",
    });
  }
}

const migration: Migration = {
  version: 3,
  name: "create_grievances",
  description:
    "Create the grievances record table plus grievance_workers and grievance_employers link tables owned by the grievance component. grievances has required status_id/category_id FKs (ON DELETE RESTRICT) into the grievance options tables; the link tables FK workers/employers and grievances (ON DELETE RESTRICT) and are unique on their (entity_id, grievance_id) pair. Idempotent: skips any table that already exists (the enable flow creates them via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

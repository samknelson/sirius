import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "dispatch.department";

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
  if (await tableExists("worker_dispatch_department")) {
    logger.info("worker_dispatch_department table already exists, skipping creation", {
      service: "migration-dispatch.department-001",
    });
  } else {
    await db.execute(sql`
      CREATE TABLE worker_dispatch_department (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id varchar NOT NULL,
        department_id varchar NOT NULL,
        preference varchar NOT NULL,
        data jsonb,
        CONSTRAINT worker_dispatch_department_worker_id_fk
          FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        CONSTRAINT worker_dispatch_department_department_id_fk
          FOREIGN KEY (department_id) REFERENCES options_department(id) ON DELETE CASCADE,
        CONSTRAINT worker_dispatch_department_worker_id_department_id_unique
          UNIQUE (worker_id, department_id)
      )
    `);
    logger.info("Created worker_dispatch_department table", {
      service: "migration-dispatch.department-001",
    });
  }

  if (await tableExists("dispatch_job_department")) {
    logger.info("dispatch_job_department table already exists, skipping creation", {
      service: "migration-dispatch.department-001",
    });
  } else {
    await db.execute(sql`
      CREATE TABLE dispatch_job_department (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id varchar NOT NULL,
        department_id varchar NOT NULL,
        data jsonb,
        CONSTRAINT dispatch_job_department_job_id_fk
          FOREIGN KEY (job_id) REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
        CONSTRAINT dispatch_job_department_department_id_fk
          FOREIGN KEY (department_id) REFERENCES options_department(id) ON DELETE CASCADE,
        CONSTRAINT dispatch_job_department_job_id_unique
          UNIQUE (job_id)
      )
    `);
    logger.info("Created dispatch_job_department table", {
      service: "migration-dispatch.department-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "create_department_tables",
  description: "Create the worker_dispatch_department and dispatch_job_department tables owned by the dispatch.department component. Idempotent: skips creation if a table already exists (the enable flow creates them via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

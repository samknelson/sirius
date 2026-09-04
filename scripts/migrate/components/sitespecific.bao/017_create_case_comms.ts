import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

/**
 * Case ↔ comm links: the letter record for member notices. Constraint and
 * index names match the Drizzle declaration in
 * shared/schema/sitespecific/bao/schema.ts exactly, so a database that got
 * this table from the component enable-path push and one that got it from
 * this migration look the same to the drift gate.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_case_comms (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id varchar NOT NULL,
        comm_id varchar NOT NULL,
        status_id varchar,
        status_name varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sitespecific_bao_case_comms_comm_uq UNIQUE (comm_id),
        CONSTRAINT sitespecific_bao_case_comms_case_id_fkey
          FOREIGN KEY (case_id) REFERENCES sitespecific_bao_cases(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_case_comms_comm_id_fkey
          FOREIGN KEY (comm_id) REFERENCES comm(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_case_comms_status_id_fkey
          FOREIGN KEY (status_id) REFERENCES options_bao_case_status(id) ON DELETE SET NULL
      )
    `);
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_case_comms_case_idx ON sitespecific_bao_case_comms(case_id)`,
    );
  });
}

const migration: Migration = {
  version: 17,
  name: "create_case_comms",
  description: "Create the BAO case ↔ comm link table (the member letter record on a case).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

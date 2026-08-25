import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS options_bao_case_status (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL UNIQUE,
        description text,
        closed boolean NOT NULL DEFAULT false,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb
      )
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS options_bao_case_resolution (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL UNIQUE,
        description text,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb
      )
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_cases (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar NOT NULL,
        entity_id varchar NOT NULL,
        assignee_user_id varchar NOT NULL,
        status_id varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deadline_ymd date NOT NULL,
        resolution_id varchar,
        resolution_ymd date,
        data jsonb,
        CONSTRAINT sitespecific_bao_cases_entity_type_check
          CHECK (entity_type IN ('worker', 'employer', 'trust_provider')),
        CONSTRAINT sitespecific_bao_cases_resolution_pair_check
          CHECK ((resolution_id IS NULL) = (resolution_ymd IS NULL)),
        CONSTRAINT sitespecific_bao_cases_assignee_user_id_fkey
          FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT sitespecific_bao_cases_status_id_fkey
          FOREIGN KEY (status_id) REFERENCES options_bao_case_status(id) ON DELETE RESTRICT,
        CONSTRAINT sitespecific_bao_cases_resolution_id_fkey
          FOREIGN KEY (resolution_id) REFERENCES options_bao_case_resolution(id) ON DELETE RESTRICT
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_entity_idx ON sitespecific_bao_cases(entity_type, entity_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_assignee_idx ON sitespecific_bao_cases(assignee_user_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_status_idx ON sitespecific_bao_cases(status_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_deadline_idx ON sitespecific_bao_cases(deadline_ymd)`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_case_notes (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id varchar NOT NULL,
        note_id varchar NOT NULL,
        CONSTRAINT sitespecific_bao_case_notes_note_uq UNIQUE (note_id),
        CONSTRAINT sitespecific_bao_case_notes_case_note_uq UNIQUE (case_id, note_id),
        CONSTRAINT sitespecific_bao_case_notes_case_id_fkey
          FOREIGN KEY (case_id) REFERENCES sitespecific_bao_cases(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_case_notes_note_id_fkey
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE RESTRICT
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_case_notes_case_idx ON sitespecific_bao_case_notes(case_id)`);
  });
}

const migration: Migration = {
  version: 10,
  name: "create_case_management",
  description: "Create BAO case statuses, resolutions, cases, and one-case-per-note links.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;
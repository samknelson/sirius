import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
     await tx.execute(sql`
       CREATE TABLE IF NOT EXISTS options_bao_case_type (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         name varchar(255) NOT NULL UNIQUE,
         description text,
         sequence integer NOT NULL DEFAULT 0,
         workflow_code varchar(64) NOT NULL UNIQUE,
         data jsonb
       )
     `);
     await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS options_bao_case_status (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL UNIQUE,
        description text,
        closed boolean NOT NULL DEFAULT false,
        sequence integer NOT NULL DEFAULT 0,
         case_type_id varchar NOT NULL,
         duration_days integer,
         workflow_step varchar(64),
         default_resolution_id varchar,
         requires_outreach_note boolean NOT NULL DEFAULT false,
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
         case_type_id varchar NOT NULL,
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
     await tx.execute(sql`ALTER TABLE sitespecific_bao_cases ADD COLUMN IF NOT EXISTS case_type_id varchar`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS case_type_id varchar`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS duration_days integer`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS workflow_step varchar(64)`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS default_resolution_id varchar`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS requires_outreach_note boolean NOT NULL DEFAULT false`);
     await tx.execute(sql`INSERT INTO options_bao_case_type (name, description, sequence, workflow_code) VALUES
       ('General', 'General BAO case', 0, 'general'),
       ('Benefit Appeal', 'Benefit appeal workflow', 1, 'benefit_appeal')
       ON CONFLICT (workflow_code) DO NOTHING`);
     await tx.execute(sql`UPDATE sitespecific_bao_cases SET case_type_id = (SELECT id FROM options_bao_case_type WHERE workflow_code = 'general') WHERE case_type_id IS NULL`);
     await tx.execute(sql`UPDATE options_bao_case_status SET case_type_id = (SELECT id FROM options_bao_case_type WHERE workflow_code = 'general') WHERE case_type_id IS NULL`);
     await tx.execute(sql`ALTER TABLE sitespecific_bao_cases ALTER COLUMN case_type_id SET NOT NULL`);
     await tx.execute(sql`ALTER TABLE options_bao_case_status ALTER COLUMN case_type_id SET NOT NULL`);
     await tx.execute(sql`INSERT INTO options_bao_case_status (name, closed, sequence, case_type_id, duration_days, workflow_step, requires_outreach_note)
       SELECT x.name, x.closed, x.sequence, t.id, x.duration_days, x.workflow_step, x.requires_outreach_note
       FROM (VALUES
         ('Submitted', false, 0, NULL::int, 'submitted', false),
         ('Auto-Denied', false, 1, 90, 'auto_denied', false),
         ('Trustee Review', false, 2, 30, 'trustee_review', false),
         ('Approved', true, 3, NULL, 'approved', true),
         ('Closed–Denied', true, 4, NULL, 'denied', true),
         ('Closed–No Response', true, 5, NULL, 'no_response', false)
       ) AS x(name, closed, sequence, duration_days, workflow_step, requires_outreach_note)
       CROSS JOIN (SELECT id FROM options_bao_case_type WHERE workflow_code = 'benefit_appeal') t
       WHERE NOT EXISTS (SELECT 1 FROM options_bao_case_status s WHERE s.name = x.name)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_entity_idx ON sitespecific_bao_cases(entity_type, entity_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_assignee_idx ON sitespecific_bao_cases(assignee_user_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_status_idx ON sitespecific_bao_cases(status_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_cases_deadline_idx ON sitespecific_bao_cases(deadline_ymd)`);
    const notesTable = sql.raw(await coreNotesTable(tx));
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
          FOREIGN KEY (note_id) REFERENCES ${notesTable}(id) ON DELETE RESTRICT
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_case_notes_case_idx ON sitespecific_bao_case_notes(case_id)`);
  });
}

/**
 * Core notes table name. Core migration 1146 (upstream 1072) renames `notes`
 * to `entity_notes`; core runs before component migrations, so a fresh
 * install sees the new name while databases stamped before the rename saw
 * the old one. Resolve at run time rather than hard-coding either.
 */
async function coreNotesTable(exec: { execute: (q: any) => Promise<{ rows?: unknown[] }> }): Promise<"notes" | "entity_notes"> {
  const r = await exec.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'entity_notes'`);
  return (r.rows ?? []).length > 0 ? "entity_notes" : "notes";
}

const migration: Migration = {
  version: 10,
  name: "create_case_management",
  description: "Create BAO case statuses, resolutions, cases, and one-case-per-note links.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;
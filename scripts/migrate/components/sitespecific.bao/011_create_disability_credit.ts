import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_cases (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'open',
        opened_ymd date NOT NULL,
        qualifying_basis jsonb NOT NULL,
        terminal_reason text,
        terminal_ymd date,
        created_at timestamptz NOT NULL DEFAULT now(),
        data jsonb,
        CONSTRAINT sitespecific_bao_dc_cases_status_check
          CHECK (status IN ('open', 'closed', 'void')),
        CONSTRAINT sitespecific_bao_dc_cases_terminal_reason_check
          CHECK (((status)::text = 'open') = (terminal_reason IS NULL AND terminal_ymd IS NULL)),
        CONSTRAINT sitespecific_bao_dc_cases_worker_id_fkey
          FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS sitespecific_bao_dc_cases_worker_live_uq
        ON sitespecific_bao_dc_cases (worker_id) WHERE (status)::text = 'open'
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_cases_worker_idx ON sitespecific_bao_dc_cases(worker_id)`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_case_months (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id varchar NOT NULL,
        worker_id varchar NOT NULL,
        work_month_ymd date NOT NULL,
        status varchar NOT NULL DEFAULT 'live',
        void_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        data jsonb,
        CONSTRAINT sitespecific_bao_dc_case_months_status_check
          CHECK (status IN ('live', 'void')),
        CONSTRAINT sitespecific_bao_dc_case_months_void_reason_check
          CHECK (((status)::text = 'void') = (void_reason IS NOT NULL)),
        CONSTRAINT sitespecific_bao_dc_case_months_first_day_check
          CHECK (EXTRACT(DAY FROM work_month_ymd) = 1),
        CONSTRAINT sitespecific_bao_dc_case_months_case_id_fkey
          FOREIGN KEY (case_id) REFERENCES sitespecific_bao_dc_cases(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_dc_case_months_worker_id_fkey
          FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS sitespecific_bao_dc_case_months_worker_month_live_uq
        ON sitespecific_bao_dc_case_months (worker_id, work_month_ymd) WHERE (status)::text = 'live'
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_case_months_case_idx ON sitespecific_bao_dc_case_months(case_id)`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_denial_letters (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id varchar NOT NULL,
        letter_ymd date NOT NULL,
        received_ymd date,
        voided_ymd date,
        void_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        data jsonb,
        CONSTRAINT sitespecific_bao_dc_denial_letters_void_pair_check
          CHECK ((voided_ymd IS NULL) = (void_reason IS NULL)),
        CONSTRAINT sitespecific_bao_dc_denial_letters_worker_id_fkey
          FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_denial_letters_worker_idx ON sitespecific_bao_dc_denial_letters(worker_id)`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_documents (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_kind varchar NOT NULL,
        case_id varchar,
        denial_letter_id varchar,
        file_id varchar,
        name varchar(512) NOT NULL,
        content_type varchar(255),
        uploaded_by_user_id varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        data jsonb,
        CONSTRAINT sitespecific_bao_dc_documents_parent_check
          CHECK (((parent_kind)::text = 'case' AND case_id IS NOT NULL AND denial_letter_id IS NULL) OR ((parent_kind)::text = 'denial_letter' AND denial_letter_id IS NOT NULL AND case_id IS NULL)),
        CONSTRAINT sitespecific_bao_dc_documents_case_id_fkey
          FOREIGN KEY (case_id) REFERENCES sitespecific_bao_dc_cases(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_dc_documents_denial_letter_id_fkey
          FOREIGN KEY (denial_letter_id) REFERENCES sitespecific_bao_dc_denial_letters(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_dc_documents_uploaded_by_user_id_fkey
          FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_documents_case_idx ON sitespecific_bao_dc_documents(case_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_documents_denial_letter_idx ON sitespecific_bao_dc_documents(denial_letter_id)`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_case_notes (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id varchar NOT NULL,
        author_user_id varchar NOT NULL,
        body text NOT NULL,
        corrects_note_id varchar,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sitespecific_bao_dc_case_notes_case_id_fkey
          FOREIGN KEY (case_id) REFERENCES sitespecific_bao_dc_cases(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_dc_case_notes_author_user_id_fkey
          FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT sitespecific_bao_dc_case_notes_corrects_note_id_fkey
          FOREIGN KEY (corrects_note_id) REFERENCES sitespecific_bao_dc_case_notes(id) ON DELETE RESTRICT
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_case_notes_case_idx ON sitespecific_bao_dc_case_notes(case_id)`);

    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS sitespecific_bao_dc_events (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar NOT NULL,
        worker_id varchar NOT NULL,
        case_id varchar,
        dedupe_key varchar(512) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sitespecific_bao_dc_events_dedupe_key_unique UNIQUE (dedupe_key),
        CONSTRAINT sitespecific_bao_dc_events_event_type_check
          CHECK (event_type IN ('case_opened', 'case_closed', 'case_voided', 'case_month_added', 'case_month_voided', 'denial_letter_recorded', 'denial_letter_voided'))
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_dc_events_worker_idx ON sitespecific_bao_dc_events(worker_id)`);
  });
}

const migration: Migration = {
  version: 11,
  name: "create_disability_credit",
  description:
    "Create Disability Credit foundation tables: cases, case months, denial letters, documents, append-only case notes, and the idempotent DC event log.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;

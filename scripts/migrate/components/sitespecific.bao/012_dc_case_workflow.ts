import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

/**
 * Disability Credit workflow upgrade.
 *
 * Replaces the foundation's coarse case statuses (open/closed/void) with the
 * full review lifecycle (draft/ready_for_review/in_queue/approved/denied/
 * withdrawn/void) and the month statuses (live/void) with the workflow set
 * (selected/queued/granted/removed). Existing rows are mapped:
 *   cases:  open -> draft, closed -> withdrawn (reason preserved)
 *   months: live -> selected, void -> removed
 *
 * Also:
 * - Drops the one-live-case-per-worker unique index: a second open case is
 *   now allowed after an EXPLICIT duplicate confirmation (warned in the UI,
 *   confirmed via the API flag) — enforcement moved to the workflow service.
 * - Adds intake channel, created-by/approved-by, and the staff attestations
 *   snapshot to cases.
 * - Adds document type + supersession marking (documents are never deleted).
 * - Widens the DC event-type domain with the workflow events.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    // --- Cases: lifecycle statuses -------------------------------------
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_cases_status_check
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_cases_terminal_reason_check
    `);
    await tx.execute(sql`
      UPDATE sitespecific_bao_dc_cases SET status = 'draft' WHERE status = 'open'
    `);
    await tx.execute(sql`
      UPDATE sitespecific_bao_dc_cases SET status = 'withdrawn' WHERE status = 'closed'
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD CONSTRAINT sitespecific_bao_dc_cases_status_check
        CHECK (status IN ('draft', 'ready_for_review', 'in_queue', 'approved', 'denied', 'withdrawn', 'void'))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD CONSTRAINT sitespecific_bao_dc_cases_terminal_reason_check
        CHECK (((status)::text IN ('denied', 'withdrawn', 'void')) = (terminal_reason IS NOT NULL AND terminal_ymd IS NOT NULL))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases ALTER COLUMN status SET DEFAULT 'draft'
    `);
    // Duplicate open cases are allowed after explicit confirmation.
    await tx.execute(sql`
      DROP INDEX IF EXISTS sitespecific_bao_dc_cases_worker_live_uq
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD COLUMN IF NOT EXISTS intake_channel varchar NOT NULL DEFAULT 'msr',
        ADD COLUMN IF NOT EXISTS created_by_user_id varchar,
        ADD COLUMN IF NOT EXISTS approved_by_user_id varchar,
        ADD COLUMN IF NOT EXISTS attestations jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_cases_intake_channel_check
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD CONSTRAINT sitespecific_bao_dc_cases_intake_channel_check
        CHECK (intake_channel IN ('member_portal', 'msr'))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_cases_created_by_user_id_fkey
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD CONSTRAINT sitespecific_bao_dc_cases_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_cases_approved_by_user_id_fkey
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_cases
        ADD CONSTRAINT sitespecific_bao_dc_cases_approved_by_user_id_fkey
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    `);

    // --- Case months: workflow statuses --------------------------------
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_case_months
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_case_months_status_check
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_case_months
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_case_months_void_reason_check
    `);
    await tx.execute(sql`
      UPDATE sitespecific_bao_dc_case_months SET status = 'selected' WHERE status = 'live'
    `);
    await tx.execute(sql`
      UPDATE sitespecific_bao_dc_case_months SET status = 'removed' WHERE status = 'void'
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_case_months
        ADD CONSTRAINT sitespecific_bao_dc_case_months_status_check
        CHECK (status IN ('selected', 'queued', 'granted', 'removed'))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_case_months
        ADD CONSTRAINT sitespecific_bao_dc_case_months_void_reason_check
        CHECK (((status)::text = 'removed') = (void_reason IS NOT NULL))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_case_months ALTER COLUMN status SET DEFAULT 'selected'
    `);
    await tx.execute(sql`
      DROP INDEX IF EXISTS sitespecific_bao_dc_case_months_worker_month_live_uq
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS sitespecific_bao_dc_case_months_worker_month_live_uq
        ON sitespecific_bao_dc_case_months (worker_id, work_month_ymd) WHERE (status)::text <> 'removed'
    `);

    // --- Documents: type + supersession ---------------------------------
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_documents
        ADD COLUMN IF NOT EXISTS doc_type varchar NOT NULL DEFAULT 'other',
        ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
        ADD COLUMN IF NOT EXISTS superseded_by_user_id varchar
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_documents
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_documents_doc_type_check
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_documents
        ADD CONSTRAINT sitespecific_bao_dc_documents_doc_type_check
        CHECK (doc_type IN ('dc_form', 'doctor_note', 'wsr', 'employer_accommodation_letter', 'denial_letter', 'other'))
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_documents
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_documents_superseded_by_user_id_fkey
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_documents
        ADD CONSTRAINT sitespecific_bao_dc_documents_superseded_by_user_id_fkey
        FOREIGN KEY (superseded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    `);

    // --- Events: workflow event kinds -----------------------------------
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_events
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_events_event_type_check
    `);
    await tx.execute(sql`
      ALTER TABLE sitespecific_bao_dc_events
        ADD CONSTRAINT sitespecific_bao_dc_events_event_type_check
        CHECK (event_type IN ('case_opened', 'case_closed', 'case_voided', 'case_month_added', 'case_month_voided', 'denial_letter_recorded', 'denial_letter_voided', 'case_status_changed', 'document_uploaded', 'document_superseded', 'attestations_updated'))
    `);
  });
}

const migration: Migration = {
  version: 12,
  name: "dc_case_workflow",
  description:
    "Upgrade Disability Credit to the full case workflow: lifecycle statuses, month workflow statuses, intake channel, attestations, document types + supersession, and workflow event kinds.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;

import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

/**
 * Disability Credit extensions + case-note retirement.
 *
 * 1. Widens the DC event-type CHECK to admit `case_extension_requested` —
 *    an extension is modeled as a NEW linked case; the request is recorded
 *    durably against the PARENT (approved) case.
 *
 * 2. Retires the bespoke `sitespecific_bao_dc_case_notes` table. Historical
 *    rows are archived into the core `notes` table under a get-or-created
 *    "Disability Credit (archived)" note type against the case's WORKER
 *    (the note-able entity in the shared registry), preserving author,
 *    timestamp, body and provenance (`data.dcCaseId` / `data.originalNoteId`
 *    / `data.correctsNoteId`). The table is then dropped — no parallel
 *    notes implementation remains.
 *
 * Idempotent: named-constraint drop/recreate; the archive step only runs
 * while the legacy table still exists, and inserts skip rows already
 * archived (matched on data.originalNoteId).
 */
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
  version: 14,
  name: "dc_extensions_and_notes_retirement",
  description:
    "Admit case_extension_requested DC events; archive DC case notes into core notes and drop the bespoke table",

  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        ALTER TABLE sitespecific_bao_dc_events
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_events_event_type_check
      `);
      await tx.execute(sql`
        ALTER TABLE sitespecific_bao_dc_events
        ADD CONSTRAINT sitespecific_bao_dc_events_event_type_check
        CHECK (event_type IN ('case_opened', 'case_closed', 'case_voided', 'case_month_added', 'case_month_voided', 'denial_letter_recorded', 'denial_letter_voided', 'case_status_changed', 'document_uploaded', 'document_superseded', 'attestations_updated', 'case_month_granted', 'case_month_queued', 'case_month_released', 'case_month_reconciled', 'case_extension_requested'))
      `);

      const legacyExists = await tx.execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'sitespecific_bao_dc_case_notes'
      `);
      if ((legacyExists.rows ?? []).length > 0) {
        const hasRows = await tx.execute(sql`
          SELECT 1 FROM sitespecific_bao_dc_case_notes LIMIT 1
        `);
        if ((hasRows.rows ?? []).length > 0) {
          // Get-or-create the archive note type (applies to workers).
          // Column name follows the table: 1147 renames entity_type -> context_id,
          // and 1150 renames the note-type key entityTypes -> contextIds.
          const notesTable = await coreNotesTable(tx);
          const notesTableSql = sql.raw(notesTable);
          const contextColumn = sql.raw(notesTable === "entity_notes" ? "context_id" : "entity_type");
          const appliesToKey = notesTable === "entity_notes" ? "contextIds" : "entityTypes";
          await tx.execute(sql`
            INSERT INTO options_note_type (name, description, data)
            SELECT 'Disability Credit (archived)',
                   'Historical Disability Credit case notes archived when the bespoke DC notes table was retired.',
                   ${JSON.stringify({ [appliesToKey]: ["worker"] })}::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM options_note_type WHERE name = 'Disability Credit (archived)'
            )
          `);
          await tx.execute(sql`
            INSERT INTO ${notesTableSql} (${contextColumn}, entity_id, type_id, subject, body, timestamp, user_id, data)
            SELECT
              'worker',
              c.worker_id,
              (SELECT id FROM options_note_type WHERE name = 'Disability Credit (archived)' LIMIT 1),
              'Disability Credit case note (archived)',
              n.body,
              n.created_at,
              n.author_user_id,
              jsonb_build_object(
                'dcCaseId', n.case_id,
                'originalNoteId', n.id,
                'correctsNoteId', n.corrects_note_id,
                'archivedFrom', 'sitespecific_bao_dc_case_notes'
              )
            FROM sitespecific_bao_dc_case_notes n
            JOIN sitespecific_bao_dc_cases c ON c.id = n.case_id
            WHERE NOT EXISTS (
              SELECT 1 FROM ${notesTableSql} a WHERE a.data->>'originalNoteId' = n.id
            )
          `);
        }
        await tx.execute(sql`DROP TABLE IF EXISTS sitespecific_bao_dc_case_notes`);
      }
    });
  },
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;

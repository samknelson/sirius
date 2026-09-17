import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Repairs GBHET Legal Workers Monthly runs that completed all processing
 * successfully but remained top-level drafts because the migrated feed
 * process step did not return a completed status to the dispatcher.
 *
 * Deliberately excludes:
 * - genuine drafts whose process step has not completed;
 * - processed runs reporting one or more failed rows;
 * - other wizard types.
 *
 * Idempotent: repaired rows no longer match status = 'draft'.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    UPDATE wizards
    SET status = 'completed'
    WHERE type = 'gbhet_legal_workers_monthly'
      AND status = 'draft'
      AND jsonb_typeof(data) = 'object'
      AND jsonb_typeof(data->'progress') = 'object'
      AND jsonb_typeof(data->'progress'->'process') = 'object'
      AND data->'progress'->'process'->>'status' = 'completed'
      AND jsonb_typeof(data->'processResults') = 'object'
      AND jsonb_typeof(data->'processResults'->'failureCount') = 'number'
      AND data->'processResults'->'failureCount' = '0'::jsonb
  `);

  logger.info("Repaired completed GBHET legal worker wizard statuses", {
    service: "migration-1049",
    updatedCount: result.rowCount ?? 0,
  });
}

registerMigration({
  version: 1049,
  name: "complete_processed_gbhet_legal_wizards",
  description:
    "Mark successfully processed GBHET Legal Workers Monthly wizard drafts as completed",
  up,
});
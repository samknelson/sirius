import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1097";

/**
 * Drop `employer_policy_history.created_at`, now that 1096 has moved what it
 * knew into provenance.
 *
 * Everything that read it reads `entity_metadata.created_date` instead: the
 * history page's recorded-at column, and the ordering both that page and the
 * employer's current-policy denormalization apply within one effective date
 * (`server/storage/employers/policy-history.ts`). The effective `date` column
 * is untouched — that one is business data.
 *
 * Idempotent (IF EXISTS). Nothing depends on the column: no index, no
 * constraint, no view.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE employer_policy_history DROP COLUMN IF EXISTS created_at`,
  );

  logger.info("Dropped employer_policy_history.created_at", { service: SERVICE });
}

const migration: Migration = {
  version: 1097,
  name: "drop_policy_history_created_at",
  description:
    "Drop the bespoke created_at column from employer_policy_history; its recorded-at date now lives in entity_metadata (seeded by 1096) and every read has been repointed there.",
  up,
};

registerMigration(migration);

export default migration;

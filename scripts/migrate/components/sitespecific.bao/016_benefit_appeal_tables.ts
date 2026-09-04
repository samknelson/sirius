import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

/**
 * Benefit Appeal tables.
 *
 * The appeal intake added `options_bao_appeal_denial_reason` (the denial
 * reasons a Benefit Appeal is opened against), `sitespecific_bao_appeal_details`
 * (one row per appeal case: the reason it was denied for) and a nullable
 * `benefit_id` on `sitespecific_bao_cases` (the benefit being appealed) to the
 * Drizzle schema. A fresh enable creates all of that from the schema; a
 * deployment whose BAO schema predates the appeal work only gets it from here.
 *
 * Constraint names mirror what the enable-path push renders for the schema
 * declarations, so a migrated database and a freshly enabled one are
 * identical: Drizzle's `<table>_<column>_unique` for inline `.unique()`, and
 * the explicit `_fkey` names the schema pins on its foreign keys.
 *
 * Idempotent: IF NOT EXISTS throughout; no data is written.
 */
const migration: Migration = {
  version: 16,
  name: "benefit_appeal_tables",
  description:
    "Create the Benefit Appeal tables (options_bao_appeal_denial_reason, sitespecific_bao_appeal_details) and add sitespecific_bao_cases.benefit_id.",
  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS options_bao_appeal_denial_reason (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          name varchar(255) NOT NULL,
          description text,
          sequence integer NOT NULL DEFAULT 0,
          data jsonb,
          CONSTRAINT options_bao_appeal_denial_reason_name_unique UNIQUE (name)
        )
      `);
      await tx.execute(sql`
        ALTER TABLE sitespecific_bao_cases ADD COLUMN IF NOT EXISTS benefit_id varchar
      `);
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS sitespecific_bao_appeal_details (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          case_id varchar NOT NULL,
          denial_reason_id varchar NOT NULL,
          data jsonb,
          CONSTRAINT sitespecific_bao_appeal_details_case_id_unique UNIQUE (case_id),
          CONSTRAINT sitespecific_bao_appeal_details_case_id_fkey
            FOREIGN KEY (case_id) REFERENCES sitespecific_bao_cases(id) ON DELETE CASCADE,
          CONSTRAINT sitespecific_bao_appeal_details_denial_reason_id_fkey
            FOREIGN KEY (denial_reason_id) REFERENCES options_bao_appeal_denial_reason(id) ON DELETE RESTRICT
        )
      `);
    });
  },
};

registerComponentMigration("sitespecific.bao", migration);

export default migration;

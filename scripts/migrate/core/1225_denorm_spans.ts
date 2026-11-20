import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1225,
  name: "denorm_spans",
  description: "Add generic denorm-owned continuous spans and companion issues.",
  async up() {
    // Core payload storage has no foreign keys to optional trust tables.
    await db.transaction(async tx => {
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS denorm_span (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
          subject_id varchar NOT NULL,
          start_month date NOT NULL,
          last_month date NOT NULL,
          termination_month date,
          data jsonb NOT NULL,
          CONSTRAINT denorm_span_months_check CHECK (
            extract(day from start_month) = 1 AND extract(day from last_month) = 1
            AND last_month >= start_month AND (termination_month IS NULL OR
              (extract(day from termination_month) = 1 AND termination_month > last_month)))
        );
        CREATE INDEX IF NOT EXISTS denorm_span_owner_idx ON denorm_span (denorm_id);
        CREATE INDEX IF NOT EXISTS denorm_span_subject_month_idx ON denorm_span (subject_id, start_month, last_month);
        CREATE INDEX IF NOT EXISTS denorm_span_subject_termination_idx ON denorm_span (subject_id, termination_month);
        CREATE TABLE IF NOT EXISTS denorm_issue (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
          subject_id varchar NOT NULL,
          month date NOT NULL,
          reason varchar NOT NULL,
          data jsonb NOT NULL,
          CONSTRAINT denorm_issue_month_check CHECK (extract(day from month) = 1)
        );
        CREATE INDEX IF NOT EXISTS denorm_issue_owner_idx ON denorm_issue (denorm_id);
        CREATE INDEX IF NOT EXISTS denorm_issue_subject_month_idx ON denorm_issue (subject_id, month);
      `);
    });
  },
};
registerMigration(migration);
export default migration;

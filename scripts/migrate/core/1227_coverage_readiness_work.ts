import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1227,
  name: "coverage_readiness_work",
  description: "Keep privacy-safe aggregate producer attribution for coverage readiness work.",
  async up() {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coverage_readiness_work (
        config_id varchar NOT NULL REFERENCES plugin_configs(id) ON DELETE CASCADE,
        operation varchar NOT NULL,
        call_count bigint NOT NULL DEFAULT 0,
        affected_count bigint NOT NULL DEFAULT 0,
        last_affected_count integer NOT NULL DEFAULT 0,
        last_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT coverage_readiness_work_pk PRIMARY KEY (config_id, operation),
        CONSTRAINT coverage_readiness_work_operation_check CHECK (operation IN (
          'role_history_source_change',
          'termination_evidence_change',
          'scan_month_reset',
          'scan_worker_requeue',
          'scan_worker_reset',
          'scan_worker_bulk_reset',
          'scan_completion_inferred_evidence',
          'wmb_scan_completion_handoff',
          'migration_termination_reconciliation',
          'employer_classification_change'
        ))
      )
    `);
  },
};

registerMigration(migration);
export default migration;

import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  await storage.rawSql.execute(`
    CREATE TABLE IF NOT EXISTS wizard_employment_status_mappings (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_id VARCHAR(36) NOT NULL,
      source_status TEXT NOT NULL,
      target_status_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT wizard_emp_status_map_unique UNIQUE (employer_id, source_status)
    )
  `);

  logger.info("Created wizard_employment_status_mappings table", {
    service: "migration-002"
  });
}

const migration: Migration = {
  version: 2,
  name: "wizard_employment_status_mappings",
  description: "Create wizard_employment_status_mappings table for mapping unrecognized employment statuses to system statuses",
  up
};

registerMigration(migration);

export default migration;

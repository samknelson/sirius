import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1090";

/**
 * Auth identities are provider-managed process state and are excluded from
 * entity_metadata. Preserve their local timestamps instead of routing them
 * through the record-history framework.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving auth_identities.created_at and updated_at; auth identities are excluded from entity metadata",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1090,
  name: "retire_auth_identity_timestamps",
  description:
    "Preserve auth_identities.created_at and updated_at because auth identities are excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;
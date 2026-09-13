import { db } from "../../../server/db";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import {
  deleteLegacyCommServiceConfigs,
} from "../helpers/comm-service-config-cleanup";
import {
  isEnvironmentVariableSetInProcess,
  registerEnvironmentVariable,
} from "../../../server/config/env-registry";

/**
 * Delete obsolete service_config:* communication rows only after the
 * corresponding canonical wc-vendor selections are proven usable.
 *
 * The migration deliberately never selects variables.value: old provider
 * payloads may contain credentials, and cleanup neither needs nor logs them.
 * Validation and deletion share one transaction so one incomplete medium
 * preserves every legacy row for an administrator to repair.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await deleteLegacyCommServiceConfigs(
      tx,
      (name) => {
        // Match runtime wc-vendor resolution: credential names are supplied by
        // configuration, so custom names are registered dynamically as secret
        // before presence is checked. This reads only presence, never value.
        registerEnvironmentVariable({
          name,
          description: "Vendor credential secret checked by communication settings cleanup.",
          secret: true,
          category: "webclient",
          changeTakesEffect: "immediate",
        });
        return isEnvironmentVariableSetInProcess(name);
      },
    );
    if (deleted === 0) return;
    logger.info(
      `Removed ${deleted} obsolete communication setting row(s)`,
      { service: "migration-1112" },
    );
  });
}

const migration: Migration = {
  version: 1112,
  name: "delete_legacy_comm_service_configs",
  description:
    "Delete obsolete service_config:sms, service_config:email, and service_config:postal variable rows after validating each corresponding canonical wc-vendor selection.",
  up,
};

registerMigration(migration);

export default migration;
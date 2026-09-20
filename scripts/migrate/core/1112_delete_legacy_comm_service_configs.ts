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
  getEnvironmentVariable,
  isEnvironmentVariableSetInProcess,
  registerEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../../server/config/env-registry";

registerEnvironmentVariables([
  {
    name: "TWILIO_ACCOUNT_SID",
    description: "Legacy Twilio account SID migrated into the SMS vendor configuration.",
    secret: false,
    category: "webclient",
    changeTakesEffect: "immediate",
  },
  {
    name: "TWILIO_PHONE_NUMBER",
    description: "Legacy Twilio sending number migrated into the SMS vendor configuration.",
    secret: false,
    category: "webclient",
    changeTakesEffect: "immediate",
  },
  {
    name: "SENDGRID_FROM_EMAIL",
    description: "Legacy SendGrid sender address migrated into the email vendor configuration.",
    secret: false,
    category: "webclient",
    changeTakesEffect: "immediate",
  },
  {
    name: "SENDGRID_FROM_NAME",
    description: "Legacy SendGrid sender name migrated into the email vendor configuration.",
    secret: false,
    category: "webclient",
    changeTakesEffect: "immediate",
  },
]);

/**
 * Delete obsolete service_config:* communication rows only after the
 * corresponding canonical wc-vendor selections are proven usable.
 *
 * Legacy values are read only to recover their provider selection and known
 * non-secret settings. Credential-looking settings are never copied; remote
 * configurations store only the registered secret name. Validation, cutover,
 * and deletion share one transaction so one incomplete medium preserves every
 * legacy row and rolls back any new canonical rows.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await deleteLegacyCommServiceConfigs(
      tx,
      {
        getValue: (name) => getEnvironmentVariable(name),
        isSecretPresent: (name) => {
          // Match runtime wc-vendor resolution: custom secret names are
          // registered dynamically, then checked for presence only.
          registerEnvironmentVariable({
            name,
            description: "Vendor credential secret checked by communication settings cleanup.",
            secret: true,
            category: "webclient",
            changeTakesEffect: "immediate",
          });
          return isEnvironmentVariableSetInProcess(name);
        },
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
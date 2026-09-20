import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

/**
 * Keep existing outgoing-usage alerts attached to the live Twilio operation.
 *
 * Historical wc_stats rows retain "phone-lookup"; only saved alert rules move.
 * Whole-service Twilio rules and every other request type are untouched.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    UPDATE plugin_configs AS config
    SET data = jsonb_set(
      config.data,
      '{rules}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN rule.value->>'service' = 'Twilio'
              AND rule.value->>'requestType' = 'phone-lookup'
            THEN jsonb_set(
              rule.value,
              '{requestType}',
              '"validate-phone"'::jsonb
            )
            ELSE rule.value
          END
          ORDER BY rule.ordinality
        )
        FROM jsonb_array_elements(config.data->'rules')
          WITH ORDINALITY AS rule(value, ordinality)
      )
    )
    WHERE config.plugin_kind = 'event-notifier'
      AND config.plugin_id = 'wc-usage-alert'
      AND jsonb_typeof(config.data->'rules') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(config.data->'rules') AS rule(value)
        WHERE rule.value->>'service' = 'Twilio'
          AND rule.value->>'requestType' = 'phone-lookup'
      )
  `);

  logger.info("Retargeted Twilio phone lookup usage alerts", {
    service: "migration-1113",
    rows: result.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1113,
  name: "retarget_twilio_lookup_usage_alerts",
  description:
    "Retarget saved outgoing-usage alert rules from the retired Twilio phone-lookup request type to the wc-vendor validate-phone operation while preserving historical stats.",
  up,
};

registerMigration(migration);

export default migration;
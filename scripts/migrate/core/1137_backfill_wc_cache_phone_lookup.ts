import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import {
  PHONE_LOOKUP_SERVICE,
  PHONE_LOOKUP_REQUEST_TYPE,
} from "../../../server/services/comm/validators/phone-lookup-request";

/**
 * Carry the phone Lookup answers we have already paid for into `wc_cache`.
 *
 * Before the web client framework, the only record of a Twilio Lookup was on
 * the SMS opt-in row: `validated_at` and `validation_response`. The framework
 * reads `wc_cache` instead, so if the table starts empty every number in the
 * system is looked up again — at cost — the first time anything touches it.
 *
 * The opt-in columns are left in place. They are what the phone management UI
 * reads, and the validator keeps writing them as the cache fills.
 *
 * Idempotent: ON CONFLICT DO NOTHING, so a rerun cannot overwrite an answer
 * the running system has since refreshed.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    INSERT INTO wc_cache (
      service, request_type, request_key, request_key_hash, outcome, response, fetched_at
    )
    SELECT
      ${PHONE_LOOKUP_SERVICE},
      ${PHONE_LOOKUP_REQUEST_TYPE},
      phone_number,
      encode(sha256(convert_to(phone_number, 'UTF8')), 'hex'),
      'success'::wc_cache_outcome,
      validation_response,
      validated_at
    FROM comm_sms_optin
    WHERE validated_at IS NOT NULL
      AND validation_response IS NOT NULL
      AND phone_number IS NOT NULL
      AND phone_number <> ''
    ON CONFLICT ON CONSTRAINT wc_cache_service_type_key_hash_uniq DO NOTHING
  `);

  logger.info("Carried stored phone validations into wc_cache", {
    service: "migration-1137",
    rows: result.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1137,
  name: "backfill_wc_cache_phone_lookup",
  description:
    "Carry already-paid-for Twilio Lookup answers from comm_sms_optin (validated_at + validation_response) into wc_cache as Twilio/phone-lookup success entries keyed by the E.164 number, so moving phone validation onto the web client framework does not re-look-up every number in the system at cost. Idempotent via ON CONFLICT DO NOTHING.",
  up,
};

registerMigration(migration);

export default migration;

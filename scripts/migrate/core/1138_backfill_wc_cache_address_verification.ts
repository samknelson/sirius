import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import {
  ADDRESS_VERIFICATION_SERVICE,
  ADDRESS_VERIFICATION_REQUEST_TYPE,
} from "../../../server/services/comm/validators/address-verification-request";

/**
 * Carry the Lob address verifications we have already paid for into
 * `wc_cache`.
 *
 * Before the web client framework, the only record of a verification was on
 * the postal opt-in row: `validated_at` and `validation_response`. Nothing
 * ever read those back to decide freshness, so the same address was verified
 * again on every pass — and if the cache table starts empty, moving onto the
 * framework would do exactly that one last time, at cost, for every address
 * in the system.
 *
 * Two conditions narrow what is carried, and both matter:
 *
 *   - `rawResponse` present. That key is Lob's own fingerprint on a stored
 *     answer; a row written while the local (testing) provider was active has
 *     no such key, and carrying it would present a local format check as a
 *     vendor verification.
 *   - `valid` true. It matches what the verifier stores going forward: a "no
 *     such address" answer is real but not kept, because an address the
 *     postal service does not recognise today may be one it recognises once
 *     it is built.
 *
 * The key is `canonical_address`, which is exactly the string
 * `buildCanonicalAddress` produces and the same one the verifier keys on.
 *
 * The opt-in columns are left in place. They are what the address management
 * UI reads, and the verify path keeps writing them as the cache fills.
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
      ${ADDRESS_VERIFICATION_SERVICE},
      ${ADDRESS_VERIFICATION_REQUEST_TYPE},
      canonical_address,
      encode(sha256(convert_to(canonical_address, 'UTF8')), 'hex'),
      'success'::wc_cache_outcome,
      validation_response,
      validated_at
    FROM comm_postal_optin
    WHERE validated_at IS NOT NULL
      AND validation_response IS NOT NULL
      AND jsonb_typeof(validation_response) = 'object'
      AND jsonb_exists(validation_response, 'rawResponse')
      AND validation_response->>'valid' = 'true'
      AND canonical_address IS NOT NULL
      AND canonical_address <> ''
    ON CONFLICT ON CONSTRAINT wc_cache_service_type_key_hash_uniq DO NOTHING
  `);

  logger.info("Carried stored address verifications into wc_cache", {
    service: "migration-1138",
    rows: result.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1138,
  name: "backfill_wc_cache_address_verification",
  description:
    "Carry already-paid-for Lob address verifications from comm_postal_optin (validated_at + validation_response) into wc_cache as Lob/address-verification success entries keyed by the canonical address, so moving address verification onto the web client framework does not re-verify every address in the system at cost. Only rows carrying Lob's own rawResponse and a valid answer are carried, matching what the verifier stores going forward. Idempotent via ON CONFLICT DO NOTHING.",
  up,
};

registerMigration(migration);

export default migration;

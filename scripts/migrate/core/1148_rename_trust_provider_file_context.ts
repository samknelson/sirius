import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1148";

const OLD_ID = "trust-provider";
const NEW_ID = "trust_provider";
const OLD_TAG = `entity-files:${OLD_ID}`;
const NEW_TAG = `entity-files:${NEW_ID}`;

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Rename the trust provider file context from `trust-provider` to
 * `trust_provider`.
 *
 * The two context frameworks disagreed on how to spell this one id: notes
 * stored `trust_provider`, files stored `trust-provider`. Notes' spelling won
 * (it is the one persisted in note-type configuration), so the files side is
 * brought over — and the id is stored in three places, all of which have to
 * move together or the area's attachments become unreachable:
 *
 * - `entity_files.context_id`, the attachment rows themselves,
 * - `files.entity_type`, the ownership discriminator the download
 *   authorization resolver parses (an unknown context there refuses the
 *   download),
 * - the key in the `entity_files_config` variable, which is now validated
 *   against the registered context ids and would be rejected on the next save.
 *
 * Dev had none of the three, but a site that has been using trust provider
 * attachments has all of them. Idempotent, and refuses rather than guessing if
 * a site somehow holds both spellings of the config key.
 */
async function up(): Promise<void> {
  if (await tableExists("entity_files")) {
    const result = await db.execute(
      sql`UPDATE entity_files SET context_id = ${NEW_ID} WHERE context_id = ${OLD_ID}`,
    );
    if (result.rowCount) {
      logger.info("Renamed entity_files context id", {
        service: SERVICE,
        rows: result.rowCount,
      });
    }
  }

  if (await tableExists("files")) {
    const result = await db.execute(
      sql`UPDATE files SET entity_type = ${NEW_TAG} WHERE entity_type = ${OLD_TAG}`,
    );
    if (result.rowCount) {
      logger.info("Renamed files ownership discriminator", {
        service: SERVICE,
        rows: result.rowCount,
      });
    }
  }

  const configRows = await db.execute(
    sql`SELECT value FROM variables WHERE name = 'entity_files_config'`,
  );
  const value = configRows.rows?.[0]?.value as Record<string, unknown> | undefined;
  if (value && Object.prototype.hasOwnProperty.call(value, OLD_ID)) {
    if (Object.prototype.hasOwnProperty.call(value, NEW_ID)) {
      throw new Error(
        `entity_files_config holds both "${OLD_ID}" and "${NEW_ID}" — refusing to guess which configuration is live. Resolve by hand before re-running.`,
      );
    }
    const renamed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      renamed[key === OLD_ID ? NEW_ID : key] = entry;
    }
    await db.execute(
      sql`UPDATE variables SET value = ${JSON.stringify(renamed)}::jsonb WHERE name = 'entity_files_config'`,
    );
    logger.info("Renamed entity_files_config context key", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1148,
  name: "rename_trust_provider_file_context",
  description:
    'Rename the trust provider entity-files context id from "trust-provider" to "trust_provider", matching the notes spelling that won. Moves the id in all three places it is stored: entity_files.context_id, the files.entity_type ownership discriminator used by download authorization, and the key inside the entity_files_config variable (now validated against registered context ids). Idempotent; refuses if both spellings of the config key exist.',
  up,
};

registerMigration(migration);

export default migration;

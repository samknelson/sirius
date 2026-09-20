import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

const OLD_PLUGIN_ID = "btu-cardcheck";
const NEW_PLUGIN_ID = "sitespecific-btu-cardcheck";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rename the stored BTU WC vendor identity without replacing configuration
 * rows. Locking all matching rows makes the collision check and update one
 * serialized decision even when more than one application process boots.
 */
export async function renameBtuCardcheckVendorConfigs(
  tx: Transaction,
): Promise<number> {
  const matches = (
    await tx.execute(sql`
      SELECT id, plugin_id
      FROM plugin_configs
      WHERE plugin_kind = 'wc-vendors'
        AND plugin_id IN (${OLD_PLUGIN_ID}, ${NEW_PLUGIN_ID})
      FOR UPDATE
    `)
  ).rows as unknown as Array<{ id: string; plugin_id: string }>;

  const oldRows = matches.filter((row) => row.plugin_id === OLD_PLUGIN_ID);
  const newRows = matches.filter((row) => row.plugin_id === NEW_PLUGIN_ID);
  if (oldRows.length > 0 && newRows.length > 0) {
    throw new Error(
      `Cannot rename BTU card-check WC vendor configurations: found ` +
        `${oldRows.length} "${OLD_PLUGIN_ID}" row(s) and ` +
        `${newRows.length} "${NEW_PLUGIN_ID}" row(s). Resolve the collision ` +
        `without deleting configuration data, then rerun migration 1116.`,
    );
  }
  if (oldRows.length === 0) return 0;

  const updated = await tx.execute(sql`
    UPDATE plugin_configs
    SET plugin_id = ${NEW_PLUGIN_ID}
    WHERE plugin_kind = 'wc-vendors'
      AND plugin_id = ${OLD_PLUGIN_ID}
  `);
  return updated.rowCount ?? oldRows.length;
}

async function up(): Promise<void> {
  const updated = await db.transaction(renameBtuCardcheckVendorConfigs);
  logger.info(`Renamed ${updated} BTU card-check WC vendor configuration(s)`, {
    service: "migration-1116",
  });
}

const migration: Migration = {
  version: 1116,
  name: "rename_btu_cardcheck_vendor",
  description:
    "Rename existing wc-vendors configurations from btu-cardcheck to sitespecific-btu-cardcheck while preserving their configuration IDs, data, enabled state, and subsidiary references.",
  up,
};

registerMigration(migration);
export default migration;
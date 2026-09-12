import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Rename the `payment-gateway` plugin kind to `wc-vendors`.
 *
 * The kind stopped mandating payment-specific methods when its plugins moved
 * onto the web client framework: it now declares a typed operation registry any
 * outbound vendor can extend. Its id said payments anyway, and the id is not
 * just a label — it is the `plugin_kind` discriminator on every config row and
 * the name of the subsidiary table — so the rename is a data migration.
 *
 * Three ledger tables hold a foreign key into the subsidiary
 * (`ledger_accounts`, `ledger_paymentmethods`, `ledger_gateway_customers`).
 * Their constraints are named `<table>_gateway_config_id_fkey`, which names the
 * COLUMN and not the target table, so a table rename carries them across
 * unchanged and nothing here has to touch them. The two constraints that do
 * carry the old table's name are the subsidiary's own primary key and its `id`
 * FK to `plugin_configs`; both are renamed so `\d` stops naming a table that no
 * longer exists. Neither name is load-bearing — the startup drift gate compares
 * foreign keys by signature and primary keys by column set, precisely because
 * Drizzle's auto-names rarely match Postgres'.
 *
 * The migration runner does not wrap `up()` in a transaction, so this wraps
 * itself: a half-applied rename would leave configs whose kind no longer has a
 * subsidiary table, and the generic search inner-joins that table.
 *
 * Idempotent: every step is guarded by what it is about to change, so a rerun
 * over an already-renamed database does nothing.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const [{ old_exists, new_exists }] = (
      await tx.execute(sql`
        SELECT to_regclass('public.plugin_configs_payment_gateway') IS NOT NULL AS old_exists,
               to_regclass('public.plugin_configs_wc_vendors') IS NOT NULL AS new_exists
      `)
    ).rows as unknown as { old_exists: boolean; new_exists: boolean }[];

    if (old_exists && new_exists) {
      // Both present means something other than this migration created the new
      // table. Renaming onto it would fail anyway; say why rather than let the
      // rename's own error stand in for the explanation.
      throw new Error(
        "Both plugin_configs_payment_gateway and plugin_configs_wc_vendors exist; " +
          "cannot rename. Resolve by hand before rerunning migration 1111.",
      );
    }

    if (old_exists) {
      await tx.execute(sql`
        ALTER TABLE plugin_configs_payment_gateway RENAME TO plugin_configs_wc_vendors
      `);
      logger.info("Renamed plugin_configs_payment_gateway to plugin_configs_wc_vendors", {
        service: "migration-1111",
      });
    } else if (!new_exists) {
      // Neither table is here, which should not happen: the subsidiary is a
      // CORE table and migration 1026 creates it unconditionally, long before
      // this one runs. Create it rather than carry on, because the alternative
      // is worse in both directions — 1026 is history and will never create it
      // under the new name, and moving the discriminator while the table it
      // names is absent leaves configs the inner-joined generic search cannot
      // return, behind a drift gate that refuses to boot over the missing core
      // table. The shape is 1026's, so the auto-generated constraint names come
      // out as the renamed spellings above.
      await tx.execute(sql`
        CREATE TABLE plugin_configs_wc_vendors (
          id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE
        )
      `);
      logger.warn(
        "No wc-vendors subsidiary table found under either name; created it",
        { service: "migration-1111" },
      );
    }

    // The subsidiary's own constraints, renamed only where they still carry the
    // old table's name.
    const renames: [from: string, to: string][] = [
      ["plugin_configs_payment_gateway_pkey", "plugin_configs_wc_vendors_pkey"],
      ["plugin_configs_payment_gateway_id_fkey", "plugin_configs_wc_vendors_id_fkey"],
    ];
    for (const [from, to] of renames) {
      const present = (
        await tx.execute(sql`
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname = 'plugin_configs_wc_vendors'
            AND c.conname = ${from}
        `)
      ).rows;
      if (present.length === 0) continue;
      await tx.execute(
        sql`ALTER TABLE plugin_configs_wc_vendors RENAME CONSTRAINT ${sql.raw(`"${from}"`)} TO ${sql.raw(`"${to}"`)}`,
      );
      logger.info(`Renamed constraint ${from} to ${to}`, { service: "migration-1111" });
    }

    // The discriminator every config row carries.
    const updated = await tx.execute(sql`
      UPDATE plugin_configs SET plugin_kind = 'wc-vendors' WHERE plugin_kind = 'payment-gateway'
    `);
    logger.info(`Moved ${updated.rowCount ?? 0} config row(s) to plugin kind wc-vendors`, {
      service: "migration-1111",
    });
  });
}

const migration: Migration = {
  version: 1111,
  name: "rename_payment_gateway_kind_to_wc_vendors",
  description:
    "Rename the payment-gateway plugin kind to wc-vendors: move the plugin_kind discriminator on existing config rows, rename the plugin_configs_payment_gateway subsidiary table to plugin_configs_wc_vendors, and rename that table's own primary key and id foreign key off the old name.",
  up,
};

registerMigration(migration);

export default migration;

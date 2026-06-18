import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Make plugin_configs_charge.account a required FK.
 *
 * The "Account" field on a charge config is now mandatory. To enforce it at the
 * DB level we:
 *
 *   1. Delete any existing charge configs whose `account` is NULL. We delete the
 *      linked BASE row in plugin_configs (the subsidiary row in
 *      plugin_configs_charge has `id -> plugin_configs.id ON DELETE CASCADE`),
 *      so the cascade removes the subsidiary too and no orphaned base row
 *      remains. Per the task decision these configs are discarded, not
 *      backfilled.
 *   2. Replace the existing FK (created `ON DELETE SET NULL`, which is
 *      incompatible with a NOT NULL column) with `ON DELETE RESTRICT`, so
 *      deleting a referenced ledger account is blocked instead of producing an
 *      invalid (would-be NULL) row.
 *   3. Set the column NOT NULL.
 *
 * Idempotent: the NULL-row delete is naturally a no-op once none remain, the FK
 * is looked up dynamically and only recreated when needed, and SET NOT NULL is
 * a no-op once applied.
 */
async function up(): Promise<void> {
  // 1. Remove charge configs with a NULL account by deleting their base rows
  //    (cascade drops the subsidiary plugin_configs_charge row).
  const deleted = await db.execute(sql`
    DELETE FROM plugin_configs AS p
    USING plugin_configs_charge AS c
    WHERE c.id = p.id AND c.account IS NULL
  `);
  logger.info("Deleted charge configs with NULL account", {
    service: "migration-1021",
    deleted: deleted.rowCount ?? 0,
  });

  // 2. Drop the existing account FK (whatever it is named) and recreate it with
  //    ON DELETE RESTRICT. The constraint name is resolved dynamically so this
  //    does not depend on how the original FK was named.
  const fk = await db.execute(sql`
    SELECT con.conname AS name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'plugin_configs_charge'
      AND att.attname = 'account'
  `);
  const fkName = fk.rows?.[0]?.name as string | undefined;
  if (fkName) {
    await db.execute(
      sql`ALTER TABLE plugin_configs_charge DROP CONSTRAINT ${sql.identifier(fkName)}`,
    );
    logger.info("Dropped existing account FK", { service: "migration-1021", fkName });
  }

  await db.execute(sql`
    ALTER TABLE plugin_configs_charge
    ADD CONSTRAINT plugin_configs_charge_account_ledger_accounts_id_fk
    FOREIGN KEY (account) REFERENCES ledger_accounts(id) ON DELETE RESTRICT
  `);

  // 3. Enforce NOT NULL now that every remaining row has an account.
  await db.execute(sql`ALTER TABLE plugin_configs_charge ALTER COLUMN account SET NOT NULL`);

  logger.info("plugin_configs_charge.account is now a required RESTRICT FK", {
    service: "migration-1021",
  });
}

const migration: Migration = {
  version: 1021,
  name: "charge_account_required",
  description:
    "Make plugin_configs_charge.account NOT NULL: delete NULL-account charge configs (via their base rows), recreate the account FK as ON DELETE RESTRICT, and set the column NOT NULL",
  up,
};

registerMigration(migration);

export default migration;

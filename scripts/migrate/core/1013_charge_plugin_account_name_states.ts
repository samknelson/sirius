import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1013";

// Plugins that previously stored a single account id in settings.accountId.
// Their account is backfilled into the new first-class `account` column so
// existing charge behavior is preserved without admin intervention.
const SINGLE_ACCOUNT_PLUGIN_IDS = [
  "hour-fixed",
  "gbhe-hourly-charge",
  "gbhet-legal-hourly",
  "gbhet-legal-benefit",
  "btu-steward-attendance",
  "sitespecific-bao-echp",
];

const PENSION_SLA_PLUGIN_ID = "gbhet-pension-sla-hourly";
const PENSION_SLA_ACCOUNT_VARIABLE = "gbhet_pension_sla_account_id";

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === "t";
}

async function constraintExists(name: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = ${name}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === "t";
}

async function up(): Promise<void> {
  // 1. Add `name` column.
  if (!(await columnExists("charge_plugin_configs", "name"))) {
    await db.execute(sql`ALTER TABLE charge_plugin_configs ADD COLUMN name text`);
    logger.info("Added name column to charge_plugin_configs", { service: SERVICE });
  }

  // 2. Add `account` column.
  if (!(await columnExists("charge_plugin_configs", "account"))) {
    await db.execute(sql`ALTER TABLE charge_plugin_configs ADD COLUMN account varchar`);
    logger.info("Added account column to charge_plugin_configs", { service: SERVICE });
  }

  // 3. Backfill account for single-account plugins from settings.accountId
  //    (only when the referenced ledger account still exists).
  await db.execute(sql`
    UPDATE charge_plugin_configs c
    SET account = c.settings->>'accountId'
    WHERE c.account IS NULL
      AND c.settings->>'accountId' IS NOT NULL
      AND c.plugin_id IN (${sql.join(
        SINGLE_ACCOUNT_PLUGIN_IDS.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND EXISTS (SELECT 1 FROM ledger_accounts la WHERE la.id = c.settings->>'accountId')
  `);

  // 4. Backfill account for pension SLA hourly from the system variable
  //    (value is a jsonb scalar string; #>> '{}' extracts the unquoted text).
  await db.execute(sql`
    UPDATE charge_plugin_configs c
    SET account = (
      SELECT v.value #>> '{}' FROM variables v WHERE v.name = ${PENSION_SLA_ACCOUNT_VARIABLE} LIMIT 1
    )
    WHERE c.plugin_id = ${PENSION_SLA_PLUGIN_ID}
      AND c.account IS NULL
      AND EXISTS (
        SELECT 1 FROM ledger_accounts la
        WHERE la.id = (SELECT v.value #>> '{}' FROM variables v WHERE v.name = ${PENSION_SLA_ACCOUNT_VARIABLE} LIMIT 1)
      )
  `);

  // 5. Add FK constraint for account -> ledger_accounts(id) ON DELETE SET NULL.
  const fkName = "charge_plugin_configs_account_ledger_accounts_id_fk";
  if (!(await constraintExists(fkName))) {
    await db.execute(sql`
      ALTER TABLE charge_plugin_configs
      ADD CONSTRAINT ${sql.identifier(fkName)}
      FOREIGN KEY (account) REFERENCES ledger_accounts(id) ON DELETE SET NULL
    `);
    logger.info("Added account FK to charge_plugin_configs", { service: SERVICE });
  }

  // 6. Swap the uniqueness constraint to include account.
  const oldUnique = "charge_plugin_configs_plugin_id_scope_employer_id_unique";
  const newUnique = "charge_plugin_configs_plugin_id_scope_employer_id_account_unique";
  if (await constraintExists(oldUnique)) {
    await db.execute(sql`
      ALTER TABLE charge_plugin_configs DROP CONSTRAINT ${sql.identifier(oldUnique)}
    `);
    logger.info("Dropped old 3-column unique on charge_plugin_configs", { service: SERVICE });
  }
  if (!(await constraintExists(newUnique))) {
    await db.execute(sql`
      ALTER TABLE charge_plugin_configs
      ADD CONSTRAINT ${sql.identifier(newUnique)}
      UNIQUE (plugin_id, scope, employer_id, account)
    `);
    logger.info("Added 4-column unique on charge_plugin_configs", { service: SERVICE });
  }

  // 7. Create the per-plugin master enable state table.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS charge_plugin_states (
      plugin_id text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  logger.info("Ensured charge_plugin_states table exists", { service: SERVICE });
}

const migration: Migration = {
  version: 1013,
  name: "charge_plugin_account_name_states",
  description:
    "Add account + name columns to charge_plugin_configs, swap uniqueness to include account, " +
    "backfill single-account/pension accounts, and create charge_plugin_states master-enable table.",
  up,
};

registerMigration(migration);

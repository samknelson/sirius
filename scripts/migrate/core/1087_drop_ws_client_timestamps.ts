import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1087";

/** The bespoke timestamp columns this migration retires, table by table. */
const COLUMNS: Array<{ table: string; column: string }> = [
  { table: "ws_clients", column: "created_at" },
  { table: "ws_clients", column: "updated_at" },
  { table: "ws_client_credentials", column: "created_at" },
  { table: "ws_client_grants", column: "created_at" },
  { table: "ws_client_ip_rules", column: "created_at" },
];

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Drop the web-service configuration tables' own timestamp columns.
 *
 * `entity_metadata` now holds all five facts — the previous migration copied
 * what these columns knew, and the storage logging middleware maintains them
 * from here on, with the person each change belongs to, which the columns
 * never recorded. Keeping them would leave two answers to "when was this
 * made", only one of which is maintained.
 *
 * Nothing reads them any more: the schema no longer declares them, the admin
 * API answers with the record's history instead, and the three screens that
 * showed a created date now read it from there.
 *
 * Every drop is guarded, so this is idempotent and tolerant of a deployment
 * whose tables were created without one of them.
 */
async function up(): Promise<void> {
  for (const { table, column } of COLUMNS) {
    if (!(await columnExists(table, column))) continue;
    await db.execute(sql`ALTER TABLE ${sql.identifier(table)} DROP COLUMN ${sql.identifier(column)}`);
    logger.info(`Dropped ${table}.${column}`, { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1087,
  name: "drop_ws_client_timestamps",
  description:
    "Drop ws_clients.created_at, ws_clients.updated_at, ws_client_credentials.created_at, ws_client_grants.created_at and ws_client_ip_rules.created_at, now that entity_metadata carries the creation and modification history of all four web-service configuration tables (seeded by migration 1086 and maintained by the storage logging middleware). Every drop is guarded, so this is idempotent.",
  up,
};

registerMigration(migration);

export default migration;

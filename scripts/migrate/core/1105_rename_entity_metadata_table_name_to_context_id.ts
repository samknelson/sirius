import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/**
 * Move entity_metadata from a physical-table-shaped column to the stable
 * registry context id. Existing values are intentionally preserved.
 *
 * This runs after 1104; migrations 1103 and 1104 must continue to describe
 * the historical table_name column they were written against.
 */
async function up(): Promise<void> {
  const columns = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'entity_metadata'
      AND column_name IN ('table_name', 'context_id')
  `);
  const present = new Set(
    (columns.rows ?? []).map((row) => String((row as Record<string, unknown>).column_name)),
  );

  if (present.has("table_name") && present.has("context_id")) {
    throw new Error(
      "entity_metadata has both table_name and context_id; refusing an ambiguous rename",
    );
  }
  if (present.has("table_name")) {
    await db.execute(sql`
      ALTER TABLE entity_metadata RENAME COLUMN table_name TO context_id
    `);
  } else if (!present.has("context_id")) {
    throw new Error("entity_metadata has neither table_name nor context_id");
  }

  const indexes = await db.execute(sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'entity_metadata'
      AND indexname IN ('idx_entity_metadata_table_name', 'idx_entity_metadata_context_id')
  `);
  const indexNames = new Set(
    (indexes.rows ?? []).map((row) => String((row as Record<string, unknown>).indexname)),
  );
  if (indexNames.has("idx_entity_metadata_table_name") && indexNames.has("idx_entity_metadata_context_id")) {
    throw new Error(
      "entity_metadata has both table_name and context_id index names; refusing an ambiguous rename",
    );
  }
  if (indexNames.has("idx_entity_metadata_table_name")) {
    await db.execute(sql`
      ALTER INDEX idx_entity_metadata_table_name RENAME TO idx_entity_metadata_context_id
    `);
  }
}

const migration: Migration = {
  version: 1105,
  name: "rename_entity_metadata_table_name_to_context_id",
  description:
    "Rename entity_metadata.table_name and its index to context-oriented names without changing stored values",
  up,
};

registerMigration(migration);

export default migration;
import { sql } from "drizzle-orm";
import { db } from "../../../../server/db";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "worker.relations";
const SOURCE_RELATION_FK = "trust_wmb_source_relation_id_worker_relations_id_fk";

async function up(): Promise<void> {
  // The source column is core-owned and worker_relations is optional. This
  // migration runs when the optional target appears after core 1116 / benefits
  // were already migrated, completing the FK without requiring enable-order.
  await db.transaction(async (tx) => {
    const tableExists = async (tableName: string): Promise<boolean> => {
      const result = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${tableName}
        ) AS exists
      `);
      return result.rows[0]?.exists === true || result.rows[0]?.exists === "t";
    };
    const constraintExists = async (name: string): Promise<boolean> => {
      const result = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = 'public' AND constraint_name = ${name}
        ) AS exists
      `);
      return result.rows[0]?.exists === true || result.rows[0]?.exists === "t";
    };
    if (
      await tableExists("trust_wmb") &&
      await tableExists("worker_relations") &&
      !(await constraintExists(SOURCE_RELATION_FK))
    ) {
      const cleared = await tx.execute(sql`
        UPDATE trust_wmb w
        SET source_relation_id = NULL
        WHERE source_relation_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM worker_relations r WHERE r.id = w.source_relation_id
          )
      `);
      if ((cleared.rowCount ?? 0) > 0) {
        await tx.execute(sql`
          UPDATE denorm d
          SET status = 'stale',
              stale_at = now(),
              message = NULL,
              generation = d.generation + 1,
              claim_token = NULL,
              claim_at = NULL
          FROM plugin_configs p
          WHERE d.config_id = p.id
            AND p.plugin_kind = 'denorm'
            AND p.plugin_id = 'worker-benefit-role-history'
        `);
      }
      await tx.execute(sql`
        ALTER TABLE trust_wmb
        ADD CONSTRAINT trust_wmb_source_relation_id_worker_relations_id_fk
        FOREIGN KEY (source_relation_id) REFERENCES worker_relations(id) ON DELETE SET NULL
      `);
    }
  });
}

const migration: Migration = {
  version: 1,
  name: "add_trust_wmb_source_relation_fk",
  description: "Install trust_wmb.source_relation_id ON DELETE SET NULL FK when worker.relations is enabled after core migration.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;
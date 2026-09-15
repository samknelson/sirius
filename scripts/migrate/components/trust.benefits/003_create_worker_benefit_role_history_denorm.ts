import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "trust.benefits";
const SOURCE_RELATION_FK = "trust_wmb_source_relation_id_worker_relations_id_fk";

async function up(): Promise<void> {
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
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_benefit_role_history_denorm (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
        worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        subscriber boolean NOT NULL DEFAULT false,
        dependent boolean NOT NULL DEFAULT false,
        subscriber_month integer,
        subscriber_year integer,
        dependent_month integer,
        dependent_year integer,
        CONSTRAINT worker_benefit_role_history_denorm_worker_id_unique UNIQUE (worker_id),
        CONSTRAINT worker_benefit_role_history_denorm_month_valid
          CHECK ((subscriber_month IS NULL OR subscriber_month BETWEEN 1 AND 12)
            AND (dependent_month IS NULL OR dependent_month BETWEEN 1 AND 12)),
        CONSTRAINT worker_benefit_role_history_denorm_date_pair_valid
          CHECK ((subscriber_month IS NULL) = (subscriber_year IS NULL)
            AND (dependent_month IS NULL) = (dependent_year IS NULL)),
        CONSTRAINT worker_benefit_role_history_denorm_role_date_consistent
          CHECK ((subscriber = (subscriber_month IS NOT NULL))
            AND (dependent = (dependent_month IS NOT NULL)))
      )
    `);
    // Core migration 1116 cannot install this FK when worker.relations is
    // disabled. Recheck when benefits is enabled later; the reciprocal
    // worker.relations migration handles the opposite enablement order.
    if (await tableExists("worker_relations") && !(await constraintExists(SOURCE_RELATION_FK))) {
      // A deployment that accepted source ids before worker.relations existed
      // can contain dangling pointers. They have no retained relationship
      // evidence, so clear them before adding the integrity constraint.
      const cleared = await tx.execute(sql`
        UPDATE trust_wmb w
        SET source_relation_id = NULL
        WHERE source_relation_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM worker_relations r WHERE r.id = w.source_relation_id
          )
      `);
      if ((cleared.rowCount ?? 0) > 0) {
        // Clearing a retained relationship changes role interpretation. Existing
        // payload rows are no longer authoritative, so requeue every row for
        // this plugin config (not only receivers: older payloads may include
        // grantor facts from the same historical set).
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
  version: 3,
  name: "create_worker_benefit_role_history_denorm",
  description: "Create the trust.benefits-owned rebuildable worker subscriber/dependent history payload table.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;
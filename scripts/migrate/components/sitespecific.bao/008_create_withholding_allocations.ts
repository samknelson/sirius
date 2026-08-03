import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-008";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("sitespecific_bao_withholding_allocations"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_withholding_allocations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        wizard_id varchar NOT NULL,
        employer_id varchar NOT NULL,
        year integer NOT NULL,
        month integer NOT NULL,
        worker_id varchar NOT NULL,
        worker_ea_id varchar NOT NULL,
        amount numeric(10,2) NOT NULL,
        consumed_by_payment_id varchar,
        data jsonb,
        CONSTRAINT sitespecific_bao_withholding_alloc_wizard_worker_uq
          UNIQUE (wizard_id, worker_id),
        CONSTRAINT sitespecific_bao_withholding_alloc_wizard_id_fkey
          FOREIGN KEY (wizard_id) REFERENCES wizards(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_withholding_alloc_employer_id_fkey
          FOREIGN KEY (employer_id) REFERENCES employers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_withholding_alloc_worker_id_fkey
          FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_withholding_alloc_worker_ea_id_fkey
          FOREIGN KEY (worker_ea_id) REFERENCES ledger_ea(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_withholding_alloc_consumed_payment_fkey
          FOREIGN KEY (consumed_by_payment_id) REFERENCES ledger_payments(id) ON DELETE SET NULL
      )
    `);
    logger.info("Created sitespecific_bao_withholding_allocations table", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 8,
  name: "create_bao_withholding_allocations",
  description:
    "Create sitespecific_bao_withholding_allocations: per-worker employee-withholding amounts recorded by the BAO Monthly Hours Upload wizard, consumed later by an employer payment via the bao-er-report-to-ee-allocation charge plugin. Idempotent: CREATE is skipped when the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;

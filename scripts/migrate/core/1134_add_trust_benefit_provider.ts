import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Add an optional `provider_id` link from trust_benefits to trust_providers.
 *
 * Provider premium accounting needs to know which trust provider underwrites
 * a benefit so premium charges can be posted to that provider's ledger
 * account. Nullable; ON DELETE SET NULL so deleting a provider never blocks
 * on (or cascades into) benefits.
 *
 * Idempotent via ADD COLUMN IF NOT EXISTS plus a guarded constraint add
 * (migrations are not wrapped in a single transaction).
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE trust_benefits ADD COLUMN IF NOT EXISTS provider_id varchar`,
  );
  const existing = await db.execute(sql`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'trust_benefits'
      AND constraint_name = 'trust_benefits_provider_id_trust_providers_id_fk'
  `);
  if (!existing.rows || existing.rows.length === 0) {
    await db.execute(sql`
      ALTER TABLE trust_benefits
      ADD CONSTRAINT trust_benefits_provider_id_trust_providers_id_fk
      FOREIGN KEY (provider_id) REFERENCES trust_providers(id) ON DELETE SET NULL
    `);
  }
  logger.info("Ensured trust_benefits.provider_id column + FK", {
    service: "migration-1134",
  });
}

const migration: Migration = {
  version: 1134,
  name: "add_trust_benefit_provider",
  description:
    "Add nullable trust_benefits.provider_id (FK trust_providers ON DELETE SET NULL) linking a benefit to the trust provider that underwrites it, for provider premium accounting.",
  up,
};

registerMigration(migration);

export default migration;

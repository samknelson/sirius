import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Add a per-benefit `color` column to `trust_benefits`.
 *
 * Color is now a property of the individual benefit (e.g. "MLK" vs "Kaiser"),
 * not of the benefit type, so two benefits of the same type can be told apart
 * at a glance. Nullable: benefits without a color fall back to the muted icon
 * tint. Icon remains a property of the benefit type.
 *
 * Idempotent via ADD COLUMN IF NOT EXISTS (migrations are not wrapped in a
 * single transaction, so this self-heals on a partial re-run).
 *
 * Numbered 1102 (above the current `migrations_version` counter of 1101, which
 * the baseline `sirius-dev-20260706` advanced to) so the runner actually
 * replays it — a version <= the stored counter would be silently skipped.
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE trust_benefits ADD COLUMN IF NOT EXISTS color varchar`);
  logger.info("Ensured trust_benefits.color column", {
    service: "migration-1102",
  });
}

const migration: Migration = {
  version: 1102,
  name: "add_trust_benefit_color",
  description:
    "Add a nullable per-benefit `color` varchar column to trust_benefits so each benefit can carry its own icon tint (distinct from its benefit type).",
  up,
};

registerMigration(migration);

export default migration;

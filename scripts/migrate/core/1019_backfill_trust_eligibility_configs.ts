import { randomUUID } from "crypto";
import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

interface LegacyRule {
  pluginKey: string;
  appliesTo?: string[];
  config?: Record<string, unknown>;
}

/**
 * Backfill the legacy `policies.data.eligibilityRules` JSON blob (a map of
 * benefitId → ordered EligibilityRule[]) into the unified plugin_configs
 * (plugin_type = 'trust-eligibility') base table plus its
 * plugin_configs_benefit_eligibility subsidiary, then retire the blob.
 *
 * Each rule becomes one base row (plugin_id = pluginKey, enabled = true,
 * ordering = the rule's index within its benefit so the EXACT per-benefit
 * evaluation order is preserved, data = the rule's config object including the
 * authoritative `appliesTo` array) plus one subsidiary row (policy, benefit,
 * applies_to = the comma-joined denormalized copy of appliesTo).
 *
 * Atomic + idempotent: the whole backfill (inserts AND the blob strip) runs in
 * a single transaction, so a partial failure rolls back entirely and leaves the
 * legacy blob intact for a clean re-run — no rule is ever lost mid-benefit. Any
 * (policy, benefit) pair that already has trust-eligibility rows (from a prior
 * fully-committed run) is skipped. Rules whose benefit no longer exists in
 * trust_benefits are skipped (the subsidiary has an FK to trust_benefits).
 * Legacy ageout `minAge`/`maxAge` keys are stripped from config to match the
 * editor's cleanup.
 *
 * After every policy is processed, the `eligibilityRules` key is removed from
 * each policy's `data` jsonb. benefitIds STAYS on the policy.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const policiesRes = await tx.execute(
      sql`SELECT id, data FROM policies`,
    );
    const policies = (policiesRes.rows ?? []) as Array<{
      id: string;
      data: Record<string, unknown> | null;
    }>;

    const benefitsRes = await tx.execute(sql`SELECT id FROM trust_benefits`);
    const validBenefits = new Set(
      ((benefitsRes.rows ?? []) as Array<{ id: string }>).map((r) => r.id),
    );

    // (policy, benefit) pairs that already have rows — for idempotent re-runs
    // after a prior fully-committed run.
    const existingRes = await tx.execute(sql`
      SELECT be.policy, be.benefit
      FROM plugin_configs pc
      JOIN plugin_configs_benefit_eligibility be ON be.id = pc.id
      WHERE pc.plugin_type = 'trust-eligibility'
    `);
    const existingPairs = new Set(
      ((existingRes.rows ?? []) as Array<{ policy: string; benefit: string }>).map(
        (r) => `${r.policy}|${r.benefit}`,
      ),
    );

    let baseInserted = 0;
    let skippedBenefits = 0;

    for (const policy of policies) {
      const data = policy.data ?? {};
      const eligibilityRules = (data.eligibilityRules ?? {}) as Record<
        string,
        LegacyRule[]
      >;

      for (const [benefitId, rules] of Object.entries(eligibilityRules)) {
        if (!Array.isArray(rules) || rules.length === 0) continue;

        if (!validBenefits.has(benefitId)) {
          skippedBenefits += 1;
          logger.warn(
            `Skipping eligibility rules for unknown benefit ${benefitId} on policy ${policy.id}`,
            { service: "migration-1019" },
          );
          continue;
        }

        if (existingPairs.has(`${policy.id}|${benefitId}`)) continue;

        for (let i = 0; i < rules.length; i += 1) {
          const rule = rules[i];
          if (!rule || !rule.pluginKey) continue;

          const config: Record<string, unknown> = { ...(rule.config ?? {}) };

          // Strip legacy ageout keys to match the editor's cleanup.
          if (rule.pluginKey === "ageout") {
            delete config.minAge;
            delete config.maxAge;
          }

          // `data.appliesTo` is authoritative. Fall back to the rule-level
          // appliesTo when an older blob shape didn't mirror it into config.
          const appliesTo: string[] = Array.isArray(config.appliesTo)
            ? (config.appliesTo as string[])
            : Array.isArray(rule.appliesTo)
              ? rule.appliesTo
              : [];
          config.appliesTo = appliesTo;

          const id = randomUUID();

          await tx.execute(sql`
            INSERT INTO plugin_configs (id, plugin_type, plugin_id, enabled, name, ordering, data)
            VALUES (${id}, 'trust-eligibility', ${rule.pluginKey}, true, NULL, ${i}, ${JSON.stringify(config)}::jsonb)
          `);
          await tx.execute(sql`
            INSERT INTO plugin_configs_benefit_eligibility (id, policy, benefit, applies_to)
            VALUES (${id}, ${policy.id}, ${benefitId}, ${appliesTo.join(",")})
          `);
          baseInserted += 1;
        }
      }
    }

    const stripped = await tx.execute(sql`
      UPDATE policies
      SET data = data - 'eligibilityRules'
      WHERE data -> 'eligibilityRules' IS NOT NULL
    `);

    logger.info("Backfilled trust eligibility rules into unified plugin_configs", {
      service: "migration-1019",
      rulesInserted: baseInserted,
      skippedBenefits,
      policiesStripped: stripped.rowCount ?? 0,
    });
  });
}

const migration: Migration = {
  version: 1019,
  name: "backfill_trust_eligibility_configs",
  description:
    "Copy policies.data.eligibilityRules into the unified plugin_configs (plugin_type='trust-eligibility') + plugin_configs_benefit_eligibility tables, preserving per-benefit order; then strip the eligibilityRules blob. Idempotent.",
  up,
};

registerMigration(migration);

export default migration;

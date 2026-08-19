/**
 * POST-STAGE seed: assign every benefit carried over by seed-trust-config to
 * the EC and UH policies using only target-resolved ids.
 *
 * Run after:
 *   npx tsx scripts/s1-migration/stage.ts
 *   npx tsx scripts/s1-migration/seed-trust-config.ts
 *
 * Existing matching assignments are adopted. A non-empty differing
 * benefitIds list is treated as an operator/configuration conflict and fails
 * without overwriting it. Other policy data keys are preserved.
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { runInTransaction } from "../../server/storage/transaction-context";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { POLICY_SIRIUS_IDS } from "./lib/production-baseline";
import { acquireMigrationSeedLock } from "./lib/migration-lock";

interface StagedBenefitResolution {
  nid: string;
  title: string | null;
  mapped_id: string | null;
  benefit_id: string | null;
}

function sameStringSet(actual: string[], expected: string[]): boolean {
  if (new Set(actual).size !== actual.length) return false;
  if (new Set(expected).size !== expected.length) return false;
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

async function main() {
  const lockClient = await acquireMigrationSeedLock(pool);
  try {
    const staged = (await pool.query<StagedBenefitResolution>(`
    SELECT r.nid::text AS nid,
           r.title,
           m.s2_id AS mapped_id,
           b.id AS benefit_id
      FROM s1_staging.records r
      LEFT JOIN s1_staging.id_map m
        ON m.entity = 'benefit' AND m.s1_id = r.nid
      LEFT JOIN trust_benefits b ON b.id = m.s2_id
     WHERE r.bundle = 'sirius_trust_benefit'
     ORDER BY lower(coalesce(r.title, '')), r.nid
  `)).rows;
  if (staged.length === 0) {
    throw new Error("no staged trust benefits found; run stage.ts and seed-trust-config.ts first");
  }
  const unresolved = staged.filter((row) => !row.mapped_id || !row.benefit_id);
  if (unresolved.length > 0) {
    throw new Error(
      `${unresolved.length} staged trust benefit(s) are unresolved; run seed-trust-config.ts successfully first`,
    );
  }
  const benefitIds = [...new Set(staged.map((row) => row.benefit_id!))];
  if (benefitIds.length !== staged.length) {
    throw new Error("multiple staged trust benefits resolve to the same target benefit; refusing an ambiguous assignment");
  }

  const allPolicies = await storage.policies.getAllPolicies();
  const policies = POLICY_SIRIUS_IDS.map((siriusId) => {
    const matches = allPolicies.filter(
      (policy) => policy.siriusId.trim().toLowerCase() === siriusId.toLowerCase(),
    );
    if (matches.length !== 1 || matches[0].siriusId !== siriusId) {
      throw new Error(`policy siriusId=${siriusId} resolved to ${matches.length} exact/near rows (expected one exact row)`);
    }
    return matches[0];
  });

  const toUpdate: Array<{ id: string; siriusId: string; data: Record<string, unknown> }> = [];
  let adopted = 0;
  for (const policy of policies) {
    const data =
      policy.data && typeof policy.data === "object" && !Array.isArray(policy.data)
        ? (policy.data as Record<string, unknown>)
        : {};
    const current = data.benefitIds;
    if (current == null || (Array.isArray(current) && current.length === 0)) {
      toUpdate.push({
        id: policy.id,
        siriusId: policy.siriusId,
        data: { ...data, benefitIds },
      });
      continue;
    }
    if (!Array.isArray(current) || current.some((value) => typeof value !== "string")) {
      throw new Error(`policy ${policy.siriusId} has a malformed benefitIds value`);
    }
    if (!sameStringSet(current as string[], benefitIds)) {
      throw new Error(
        `policy ${policy.siriusId} has a non-empty benefit assignment that differs from the staged target set`,
      );
    }
    adopted++;
  }

  await withNotificationsSuppressed(() =>
    runInTransaction(async () => {
      for (const update of toUpdate) {
        const row = await storage.policies.updatePolicy(update.id, { data: update.data });
        if (!row) throw new Error(`policy ${update.siriusId} disappeared while assigning benefits`);
      }
    }),
  );

  const verifiedPolicies = await storage.policies.getAllPolicies();
  for (const siriusId of POLICY_SIRIUS_IDS) {
    const policy = verifiedPolicies.find((row) => row.siriusId === siriusId);
    const current = (policy?.data as Record<string, unknown> | null)?.benefitIds;
    if (!Array.isArray(current) || !sameStringSet(current as string[], benefitIds)) {
      throw new Error(`post-seed verification failed for policy ${siriusId}`);
    }
  }

    console.log(JSON.stringify({
      loader: "seed-policy-benefits",
      stagedBenefits: staged.length,
      assignedBenefitIds: benefitIds.length,
      policiesCreatedAssignments: toUpdate.length,
      policiesAdoptedAssignments: adopted,
      policies: [...POLICY_SIRIUS_IDS],
    }, null, 2));
  } finally {
    lockClient?.release();
  }
}

main()
  .then(async () => {
    await pool.end();
    console.log("DONE");
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

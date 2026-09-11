/**
 * Add every staged S1 benefit to the migrated EC/UH policy assignments.
 *
 * Ownership is explicit: data.s1MigrationPolicyBenefitIds records only IDs
 * this seed manages. Later daily runs may add newly staged benefits (Omada)
 * without replacing unrelated operator benefit IDs or any other policy data.
 * A missing migration-owned assignment or a vanished staged source fails
 * closed instead of silently undoing operator/source changes.
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { runInTransaction } from "../../server/storage/transaction-context";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { POLICY_SIRIUS_IDS } from "./lib/production-baseline";
import { acquireMigrationSeedLock } from "./lib/migration-lock";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import {
  buildLoaderResult,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
} from "./lib/sync";

const LOADER = "seed-policy-benefits";
const LOGIC_VERSION = 1;
const DRY_RUN = process.argv.includes("--dry-run");
const OWNED_KEY = "s1MigrationPolicyBenefitIds";

interface StagedBenefitResolution {
  nid: string;
  mapped_id: string | null;
  benefit_id: string | null;
}

const uniqueStrings = (value: unknown, label: string): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicate IDs`);
  return value as string[];
};

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  const lockClient = await acquireMigrationSeedLock(pool);
  try {
    const staged = (await pool.query<StagedBenefitResolution>(`
      SELECT r.nid::text AS nid, m.s2_id AS mapped_id, b.id AS benefit_id
        FROM s1_staging.records r
        LEFT JOIN s1_staging.id_map m
          ON m.entity = 'benefit' AND m.s1_id = r.nid
        LEFT JOIN trust_benefits b ON b.id = m.s2_id
       WHERE r.bundle = 'sirius_trust_benefit'
       ORDER BY r.nid
    `)).rows;
    if (staged.length === 0) {
      throw new Error("no staged trust benefits found; run stage.ts and seed-trust-config.ts first");
    }
    const unresolved = staged.filter((row) => !row.mapped_id || !row.benefit_id);
    if (unresolved.length > 0) {
      throw new Error(`${unresolved.length} staged trust benefit(s) are unresolved; run seed-trust-config.ts first`);
    }
    const stagedIds: string[] = [...new Set(staged.map((row) => String(row.benefit_id)))];
    if (stagedIds.length !== staged.length) {
      throw new Error("multiple staged trust benefits resolve to the same target benefit");
    }
    const stagedSet = new Set(stagedIds);

    const allPolicies = await storage.policies.getAllPolicies();
    const policies = POLICY_SIRIUS_IDS.map((siriusId) => {
      const near = allPolicies.filter((p) => p.siriusId.trim().toLowerCase() === siriusId.toLowerCase());
      if (near.length !== 1 || near[0].siriusId !== siriusId) {
        throw new Error(`policy siriusId=${siriusId} resolved to ${near.length} exact/near rows`);
      }
      return near[0];
    });

    const updates: Array<{ id: string; siriusId: string; data: Record<string, unknown>; added: number }> = [];
    let unchanged = 0;
    let preservedOperatorIds = 0;
    for (const policy of policies) {
      const data = policy.data && typeof policy.data === "object" && !Array.isArray(policy.data)
        ? policy.data as Record<string, unknown>
        : {};
      const current = uniqueStrings(data.benefitIds, `policy ${policy.siriusId} benefitIds`);
      const owned = uniqueStrings(data[OWNED_KEY], `policy ${policy.siriusId} ${OWNED_KEY}`);
      const currentSet = new Set(current);

      const removedByOperator = owned.filter((id) => !currentSet.has(id));
      if (removedByOperator.length > 0) {
        throw new Error(`policy ${policy.siriusId} is missing ${removedByOperator.length} migration-owned benefit assignment(s)`);
      }
      const vanishedSources = owned.filter((id) => !stagedSet.has(id));
      if (vanishedSources.length > 0) {
        throw new Error(`policy ${policy.siriusId} has ${vanishedSources.length} migration-owned benefit(s) no longer present in staging`);
      }

      const additions = stagedIds.filter((id) => !currentSet.has(id));
      const nextCurrent = [...current, ...additions];
      const nextOwned = [...owned, ...stagedIds.filter((id) => !owned.includes(id))];
      preservedOperatorIds += current.filter((id) => !owned.includes(id)).length;
      const markerChanged = nextOwned.length !== owned.length;
      if (additions.length === 0 && !markerChanged) {
        unchanged++;
        continue;
      }
      updates.push({
        id: policy.id,
        siriusId: policy.siriusId,
        data: { ...data, benefitIds: nextCurrent, [OWNED_KEY]: nextOwned },
        added: additions.length,
      });
    }

    if (!DRY_RUN) {
      await withNotificationsSuppressed(() => runInTransaction(async () => {
        for (const update of updates) {
          const row = await storage.policies.updatePolicy(update.id, { data: update.data });
          if (!row) throw new Error(`policy ${update.siriusId} disappeared during seed`);
        }
      }));
    }

    let verifyFailures = 0;
    const verifyRows = DRY_RUN ? policies.map((p) => {
      const planned = updates.find((u) => u.id === p.id);
      return planned ? { ...p, data: planned.data } : p;
    }) : await storage.policies.getAllPolicies();
    for (const siriusId of POLICY_SIRIUS_IDS) {
      const policy = verifyRows.find((p) => p.siriusId === siriusId);
      const data = policy?.data as Record<string, unknown> | null;
      const current = uniqueStrings(data?.benefitIds, `verified ${siriusId} benefitIds`);
      const owned = uniqueStrings(data?.[OWNED_KEY], `verified ${siriusId} ${OWNED_KEY}`);
      if (stagedIds.some((id) => !current.includes(id) || !owned.includes(id))) verifyFailures++;
    }

    const summary = emptySummary();
    summary.updated = updates.length;
    summary.unchanged = unchanged;
    const detail = {
      stagedBenefits: staged.length,
      policies: POLICY_SIRIUS_IDS.length,
      policiesUpdated: updates.length,
      assignmentsAdded: updates.reduce((n, u) => n + u.added, 0),
      preservedOperatorIds,
      ownershipKey: OWNED_KEY,
    };
    const result = buildLoaderResult({
      loader: LOADER,
      logicVersion: LOGIC_VERSION,
      dryRun: DRY_RUN,
      forceReconcile: false,
      summary,
      verifyFailures,
      detail,
    });
    emitLoaderResult(result);
    if (!DRY_RUN) {
      await recordRun(startedAt, { loader: LOADER }, result as unknown as Record<string, unknown>);
    }
    process.exitCode = loaderExitCode(result);
  } finally {
    lockClient?.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(`FATAL ${(error as Error).name}: ${String((error as Error).message ?? error).split("\n")[0]}`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
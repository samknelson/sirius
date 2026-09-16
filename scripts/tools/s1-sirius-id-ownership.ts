/**
 * Read-only Sirius-ID ownership diagnostic and explicitly approved repair.
 *
 * With no scope flags, default scope is the union of reported Sirius IDs
 * 1009069–1009085 and reported S1 worker nids 18441635–18442766. This command
 * never writes unless BOTH --apply and the exact --approve <sha256> printed by
 * an immediately preceding diagnostic are supplied. Ordinary migration
 * loaders intentionally do not call the apply API.
 *
 * Examples:
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --ids 1009069,1009070
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --apply --approve <hash>
 */
import { storage } from "../../server/storage/database";
import { pool } from "../../server/storage/db";
import {
  planSiriusIdOwnership,
  projectSiriusIdOwnershipEvidence,
  siriusIdPlanHash,
} from "../../server/storage/workers/sirius-id-ownership-plan";

const REPORTED_IDS = Array.from({ length: 17 }, (_, offset) => 1_009_069 + offset);
const REPORTED_NIDS = Array.from({ length: 1_132 }, (_, offset) => 18_441_635 + offset);

function parseIds(): number[] {
  const index = process.argv.indexOf("--ids");
  if (index < 0) throw new Error("internal: parseIds called without --ids");
  const raw = String(process.argv[index + 1] ?? "");
  const ids = raw.split(",").map((value) => Number(value.trim()));
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("--ids must be a comma-separated list of positive integer Sirius IDs.");
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

function parseNids(): number[] {
  const index = process.argv.indexOf("--nids");
  if (index < 0) throw new Error("internal: parseNids called without --nids");
  const raw = String(process.argv[index + 1] ?? "");
  const nids = raw.split(",").map((value) => Number(value.trim()));
  if (nids.length === 0 || nids.some((nid) => !Number.isSafeInteger(nid) || nid < 1)) {
    throw new Error("--nids must be a comma-separated list of positive S1 node IDs.");
  }
  return [...new Set(nids)].sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const approvalIndex = process.argv.indexOf("--approve");
  const approvalHash = approvalIndex >= 0 ? process.argv[approvalIndex + 1] : undefined;
  if (apply && (!approvalHash || !/^[a-f0-9]{64}$/i.test(approvalHash))) {
    throw new Error("--apply requires the exact 64-character hash from this diagnostic: --approve <hash>.");
  }
  if (!apply && approvalIndex >= 0) throw new Error("--approve is only valid with --apply.");

  const hasIds = process.argv.includes("--ids");
  const hasNids = process.argv.includes("--nids");
  // No flag means the reported investigation union. Supplying either flag is
  // deliberately exact: --ids does not silently broaden to reported nids,
  // and --nids does not silently broaden to reported IDs.
  const ids = hasIds ? parseIds() : !hasNids ? REPORTED_IDS : undefined;
  const nids = hasNids ? parseNids() : !hasIds ? REPORTED_NIDS : undefined;
  const snapshot = await storage.workers.getMigrationSiriusIdOwnershipSnapshot();
  const plan = planSiriusIdOwnership(
    snapshot,
    ids ? new Set(ids) : undefined,
    nids ? new Set(nids) : undefined,
  );
  const planHash = siriusIdPlanHash(plan);
  const output = {
    mode: apply ? "apply" : "diagnostic",
    scopeSiriusIds: ids ?? null,
    scopeSourceNids: nids ?? null,
    stagingPresent: snapshot.stagingPresent,
    idMapPresent: snapshot.idMapPresent,
    stagedClaims: snapshot.claims.length,
    decisions: plan.decisions,
    evidence: projectSiriusIdOwnershipEvidence(snapshot, plan),
    rekeys: plan.rekeys,
    hardBlockers: plan.hardBlockers,
    pendingRekeys: plan.pendingRekeys,
    approvalHash: planHash,
    operatorProcedure: apply
      ? "Apply re-reads source and target evidence under a workers table lock; a changed hash or any unresolved claim rolls back without writes."
      : "Review the decisions, then run this exact scoped command with --apply --approve <approvalHash>. Do not run an ordinary loader until pending rekeys are explicitly applied and this diagnostic is clean.",
  };
  if (!apply) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const result = await storage.workers.applyMigrationSiriusIdOwnershipPlan({
    approvalHash,
    siriusIds: ids,
    sourceNids: nids,
  });
  console.log(JSON.stringify({ ...output, applied: result.applied, appliedPlanHash: result.planHash }, null, 2));
}

main()
  .catch((error: unknown) => {
    // This tool never prints source rows, database URLs, or database errors.
    console.error(error instanceof Error ? error.message : "Sirius ID ownership diagnostic failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
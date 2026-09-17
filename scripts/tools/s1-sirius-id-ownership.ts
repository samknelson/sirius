/**
 * Read-only Sirius-ID ownership diagnostic and explicitly approved repair.
 *
 * No invocation writes unless BOTH --apply and the exact --approve hash from
 * the same scoped diagnostic are supplied. Shell retirement is additionally
 * opt-in: it requires --retire-shells plus either --all-shells or an exact
 * UUID list. A retirement clears sirius_id to NULL; this tool never allocates,
 * generates, or parks a numeric Sirius ID.
 *
 * Examples:
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --ids 1009069,1009070
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --retire-shells --all-shells
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --retire-shells --shell-worker-ids <uuid>,<uuid>
 *   npx tsx scripts/tools/s1-sirius-id-ownership.ts --retire-shells --all-shells --apply --approve <hash>
 */
import { storage } from "../../server/storage/database";
import { pool } from "../../server/storage/db";
import {
  SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
  planSiriusIdOwnership,
  projectSiriusIdOwnershipEvidence,
  siriusIdPlanHash,
} from "../../server/storage/workers/sirius-id-ownership-plan";

const REPORTED_IDS = Array.from({ length: 17 }, (_, offset) => 1_009_069 + offset);
const REPORTED_NIDS = Array.from({ length: 1_132 }, (_, offset) => 18_441_635 + offset);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePositiveIntegerList(flag: "--ids" | "--nids", label: string): number[] {
  const index = process.argv.indexOf(flag);
  if (index < 0) throw new Error(`internal: ${flag} parser called without its flag`);
  const raw = String(process.argv[index + 1] ?? "");
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${flag} must be a comma-separated list of positive ${label}.`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseShellWorkerIds(): string[] {
  const index = process.argv.indexOf("--shell-worker-ids");
  if (index < 0) throw new Error("internal: shell-worker UUID parser called without its flag");
  const ids = String(process.argv[index + 1] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (ids.length === 0 || ids.some((id) => !UUID.test(id))) {
    throw new Error("--shell-worker-ids must be a comma-separated list of canonical worker UUIDs.");
  }
  return [...new Set(ids)].sort();
}

function assertArgumentCombination(
  apply: boolean,
  approvalHash: string | undefined,
  retireShells: boolean,
  allShells: boolean,
  shellWorkerIds: string[] | undefined,
): void {
  if (apply && (!approvalHash || !/^[a-f0-9]{64}$/i.test(approvalHash))) {
    throw new Error("--apply requires the exact 64-character hash from this diagnostic: --approve <hash>.");
  }
  if (!apply && approvalHash != null) throw new Error("--approve is only valid with --apply.");
  if ((allShells || shellWorkerIds != null) && !retireShells) {
    throw new Error("--all-shells and --shell-worker-ids require explicit --retire-shells evidence-review mode.");
  }
  if (retireShells && !allShells && shellWorkerIds == null) {
    throw new Error("--retire-shells requires exactly one diagnostic selection: --all-shells or --shell-worker-ids <uuid,...>.");
  }
  if (allShells && shellWorkerIds != null) {
    throw new Error("Choose either --all-shells or --shell-worker-ids, not both.");
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const approvalIndex = process.argv.indexOf("--approve");
  const approvalHash = approvalIndex >= 0 ? process.argv[approvalIndex + 1] : undefined;
  const retireShells = process.argv.includes("--retire-shells");
  const allShells = process.argv.includes("--all-shells");
  const shellWorkerIds = process.argv.includes("--shell-worker-ids") ? parseShellWorkerIds() : undefined;
  assertArgumentCombination(apply, approvalHash, retireShells, allShells, shellWorkerIds);

  const hasIds = process.argv.includes("--ids");
  const hasNids = process.argv.includes("--nids");
  // The incident report remains the default source diagnostic. Supplying either
  // scope flag is exact and never silently broadens to the other report range.
  const ids = hasIds ? parsePositiveIntegerList("--ids", "integer Sirius IDs") : !hasNids ? REPORTED_IDS : undefined;
  const nids = hasNids ? parsePositiveIntegerList("--nids", "S1 node IDs") : !hasIds ? REPORTED_NIDS : undefined;
  const snapshot = await storage.workers.getMigrationSiriusIdOwnershipSnapshot();
  const plan = planSiriusIdOwnership(
    snapshot,
    ids ? new Set(ids) : undefined,
    nids ? new Set(nids) : undefined,
    { retireShells, allShells, shellWorkerIds: shellWorkerIds ? new Set(shellWorkerIds) : undefined },
  );
  const planHash = siriusIdPlanHash(plan);
  const commandScope = {
    ids: ids ?? null,
    nids: nids ?? null,
    retireShells,
    allShells,
    shellWorkerIds: shellWorkerIds ?? null,
  };
  const output = {
    format: "s1-sirius-id-ownership-report-v2",
    mode: apply ? "apply" : "diagnostic",
    planVersion: SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
    evidenceDigest: plan.evidenceDigest,
    commandScope,
    requiredApplyArguments: {
      apply: "--apply",
      approve: "--approve <approvalHash>",
      scope: commandScope,
    },
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
      ? "Apply locks workers plus present staging evidence, rechecks this versioned hash, NULL-parks affected UUIDs, writes only exact S1 authoritative rekeys, and compares worker/FK reference counts before commit."
      : "Review exported evidence. For existing shell retirement, --all-shells selects every non-NULL worker carrying shell-like provenance; ordinary workers are excluded. Use --shell-worker-ids for an exact subset. Then repeat the exact scope with --apply --approve <approvalHash>.",
  };
  if (!apply) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const result = await storage.workers.applyMigrationSiriusIdOwnershipPlan({
    approvalHash,
    siriusIds: ids,
    sourceNids: nids,
    retireShells,
    allShells,
    shellWorkerIds,
  });
  console.log(JSON.stringify({ ...output, applied: result }, null, 2));
}

main()
  .catch((error: unknown) => {
    // Export remains identifiers/provenance/counts only; never source rows,
    // contact details, database URLs, or raw database errors.
    const message = error instanceof Error ? error.message : "";
    const safeOperatorError =
      message.startsWith("--") ||
      message.startsWith("Choose ") ||
      message.startsWith("Sirius ID ownership plan") ||
      message.startsWith("The approved worker UUID") ||
      message.startsWith("Worker UUID or foreign-key") ||
      message.startsWith("Sirius ID postcondition");
    console.error(safeOperatorError ? message : "Sirius ID ownership diagnostic failed; inspect secure server diagnostics.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
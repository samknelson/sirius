/**
 * One-off smoke test for the cross-subscriber "no dual coverage" rule
 * (assertNoDualCoverage in server/storage/trust/elections.ts).
 *
 * Creates three throwaway workers (a subscriber, a dependent, and a second
 * subscriber related to the same dependent), then exercises create/update
 * through the storage layer and asserts the expected accepts/rejections.
 * All rows are deleted at the end (worker delete cascades relations,
 * elections and contacts), including leftovers from previous failed runs.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/smoke-dual-coverage.ts
 */

import { storage } from "../../server/storage/database";
import { WorkerTrustElectionValidationError } from "../../server/storage/trust/elections";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";

const NAME_A = "[DUALCOV] Subscriber A";
const NAME_D = "[DUALCOV] Dependent D";
const NAME_B = "[DUALCOV] Subscriber B";

let passed = 0;
let failed = 0;

function ok(label: string): void {
  passed += 1;
  console.log(`  PASS  ${label}`);
}

function bad(label: string, detail: string): void {
  failed += 1;
  console.error(`  FAIL  ${label} — ${detail}`);
}

async function expectRejected(
  label: string,
  fn: () => Promise<unknown>,
  mustMention: string[],
): Promise<void> {
  try {
    await fn();
    bad(label, "write was ACCEPTED but should have been rejected");
  } catch (err) {
    if (!(err instanceof WorkerTrustElectionValidationError)) {
      bad(label, `unexpected error type: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // Contact storage normalizes name casing on create, so compare
    // case-insensitively (the real message uses the stored casing).
    const msgLower = err.message.toLowerCase();
    const missing = mustMention.filter((m) => !msgLower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      bad(label, `message "${err.message}" missing: ${missing.join(", ")}`);
      return;
    }
    ok(`${label} (message: "${err.message}")`);
  }
}

async function expectAccepted<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const result = await fn();
    ok(label);
    return result;
  } catch (err) {
    bad(label, `write was REJECTED: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function deleteByName(name: string): Promise<void> {
  const found = await storage.workers.searchWorkers(name, 10);
  for (const w of found.workers) {
    if (w.displayName === name) {
      await storage.workers.deleteWorker(w.id);
    }
  }
}

async function cleanup(): Promise<void> {
  await deleteByName(NAME_A);
  await deleteByName(NAME_D);
  await deleteByName(NAME_B);
}

async function main(): Promise<void> {
  // Wipe leftovers from any previous failed run first.
  await cleanup();

  const employersAll = await storage.employers.getAllEmployers();
  const policiesAll = await storage.policies.getAllPolicies();
  const employerId = employersAll[0]?.id;
  const policyId = policiesAll[0]?.id;
  if (!employerId || !policyId) {
    throw new Error("Need at least one employer and one policy in the dev DB");
  }

  const options = createUnifiedOptionsStorage();
  const relTypes = await options.list("worker-relation-type");
  const relTypeId = relTypes[0]?.id;
  if (!relTypeId) {
    throw new Error("Need at least one worker relation type in the dev DB");
  }

  const subA = await storage.workers.createWorker(NAME_A);
  const depD = await storage.workers.createWorker(NAME_D);
  const subB = await storage.workers.createWorker(NAME_B);

  const relAD = await storage.workerRelations.create({
    worker1: subA.id,
    worker2: depD.id,
    relationType: relTypeId,
    startYmd: "2020-01-01",
  });
  const relBD = await storage.workerRelations.create({
    worker1: subB.id,
    worker2: depD.id,
    relationType: relTypeId,
    startYmd: "2020-01-01",
  });

  const base = { employerId, policyId, benefitIds: [] as string[] };

  console.log("\nScenario 1: A enrolls with dependent D (open-ended)");
  await expectAccepted("A creates election covering D", () =>
    storage.workerTrustElections.create(subA.id, {
      ...base,
      startYmd: "2031-01-01",
      relationshipIds: [relAD.id],
    }),
  );

  console.log("\nScenario 2: D tries their own overlapping election");
  await expectRejected(
    "D's own election is rejected",
    () =>
      storage.workerTrustElections.create(depD.id, {
        ...base,
        startYmd: "2031-06-01",
        relationshipIds: [],
      }),
    [NAME_D, NAME_A],
  );

  console.log("\nScenario 3: B tries to cover D on an overlapping election");
  await expectRejected(
    "B's election listing D is rejected",
    () =>
      storage.workerTrustElections.create(subB.id, {
        ...base,
        startYmd: "2031-03-01",
        relationshipIds: [relBD.id],
      }),
    [NAME_D, NAME_A],
  );

  console.log("\nScenario 4: B enrolls alone (no shared person) — allowed");
  const electionB = await expectAccepted("B creates own election without D", () =>
    storage.workerTrustElections.create(subB.id, {
      ...base,
      startYmd: "2031-03-01",
      relationshipIds: [],
    }),
  );

  console.log("\nScenario 5: A's own renewal (same subscriber) still works");
  const renewalA = await expectAccepted(
    "A creates a second open-ended election (auto end-dates the first)",
    () =>
      storage.workerTrustElections.create(subA.id, {
        ...base,
        startYmd: "2031-02-01",
        relationshipIds: [relAD.id],
      }),
  );

  console.log("\nScenario 6: shortening always works; re-extending re-checks");
  if (renewalA) {
    await expectAccepted("A's active election can be end-dated (shrink)", () =>
      storage.workerTrustElections.update(renewalA.id, { endYmd: "2031-03-31" }),
    );
    await expectAccepted(
      "D can now enroll after A's coverage ends",
      () =>
        storage.workerTrustElections.create(depD.id, {
          ...base,
          startYmd: "2031-04-01",
          relationshipIds: [],
        }),
    );
    await expectRejected(
      "extending A's election back over D's own election is rejected",
      () => storage.workerTrustElections.update(renewalA.id, { endYmd: "2031-12-31" }),
      [NAME_D],
    );
    await expectAccepted(
      "no-op update on A's election (no coverage change) still works",
      () => storage.workerTrustElections.update(renewalA.id, { benefitIds: [] }),
    );
  }

  console.log("\nScenario 7: B may cover D for a NON-overlapping window");
  if (electionB) {
    // D's own election starts 2031-04-01 open-ended; A's ended 2031-03-31.
    // A window fully before both A's start (2031-01-01) has no conflict.
    await expectAccepted("B covers D for 2030 only (before all conflicts)", () =>
      storage.workerTrustElections.create(subB.id, {
        ...base,
        startYmd: "2020-01-01",
        endYmd: "2030-06-30",
        relationshipIds: [relBD.id],
      }),
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log("Cleanup complete.");
    } catch (err) {
      console.error("Cleanup failed:", err);
      process.exitCode = 1;
    }
    process.exit();
  });

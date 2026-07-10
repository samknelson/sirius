/**
 * One-off DIAGNOSTIC (read-only): figure out why scanning Alice Alvarez does
 * not grant benefits to her dependent Grace Gallo.
 *
 * Reproduces the individual worker benefits scan path
 * (POST /workers/:id/benefits/scan -> runBenefitsScan(..., { includeDependents:true }))
 * in TEST mode and prints, step by step:
 *   - Alice's worker id
 *   - her active trust election as of the scan month (+ its relationshipIds)
 *   - her worker_1 relations active as of the scan date (what
 *     resolveCoveredDependents enumerates)
 *   - the intersection (which dependents actually get scanned)
 *   - the full people[] result of a test-mode scan
 *
 * Usage: npx tsx scripts/oneoffs/diag-alice-grace-scan.ts
 */

import { storage } from "../../server/storage/database";
import { runBenefitsScan } from "../../server/services/benefits-scan";
import { loadComponentCache } from "../../server/services/component-cache";

const AS_OF = { year: 2026, month: 6 };

async function main() {
  await loadComponentCache();
  const found = await storage.workers.searchWorkers("Alice", 20);
  const alice =
    found.workers.find((w) => w.displayName?.toLowerCase().includes("alvarez")) ??
    found.workers[0];
  if (!alice) {
    console.log("Could not find Alice Alvarez");
    return;
  }
  console.log("Alice:", alice.id, alice.displayName);

  const asOfDate = new Date(AS_OF.year, AS_OF.month, 0);
  const asOfYmd = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, "0")}-${String(asOfDate.getDate()).padStart(2, "0")}`;
  console.log("asOfYmd:", asOfYmd, "asOfDate:", asOfDate.toISOString());

  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    alice.id,
    asOfYmd,
  );
  console.log("\n=== Active election ===");
  if (!election) {
    console.log("NONE — resolveCoveredDependents returns [] (no dependents scanned)");
  } else {
    console.log({
      id: election.id,
      startYmd: election.startYmd,
      endYmd: election.endYmd,
      relationshipIds: election.relationshipIds,
      benefitIds: election.benefitIds,
    });
  }

  console.log("\n=== worker_1 relations active as of scan date ===");
  const relations = await storage.workerRelations.searchWorkerRelations({
    workerId: alice.id,
    role: "worker_1",
    activeAt: asOfDate,
  });
  for (const r of relations) {
    console.log({
      relId: r.id,
      worker2: (r as any).worker2,
      relationTypeName: r.relationTypeName,
      other: r.otherWorker
        ? [r.otherWorker.given, r.otherWorker.family].filter(Boolean).join(" ") ||
          r.otherWorker.displayName
        : null,
      inElectionRelationshipIds: election?.relationshipIds?.includes(r.id) ?? false,
    });
  }
  if (relations.length === 0) console.log("(none)");

  console.log("\n=== TEST-mode scan people[] ===");
  const result = await runBenefitsScan(
    storage,
    alice.id,
    AS_OF.month,
    AS_OF.year,
    "test",
    { includeDependents: true },
  );
  const electionBenefitIds = new Set(election?.benefitIds ?? []);
  for (const p of result.people) {
    console.log(`\n- ${p.role} ${p.name} (${p.workerId}) relType=${p.relationType}`);
    console.log(`  prevMonthBenefitIds: ${JSON.stringify(p.previousMonthBenefitIds)}`);
    for (const a of p.actions) {
      const marker = electionBenefitIds.has(a.benefitId) ? " <== ELECTION-COVERED" : "";
      console.log(`  ${a.benefitName}: eligible=${a.eligible} action=${a.action}${marker}`);
      if (electionBenefitIds.has(a.benefitId)) {
        for (const r of a.pluginResults) {
          console.log(`      [${r.pluginKey}] eligible=${r.eligible} :: ${r.reason}`);
        }
        if (a.pluginResults.length === 0) console.log("      (no applicable rules)");
      }
    }
  }
  console.log("\nsummary:", result.summary);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

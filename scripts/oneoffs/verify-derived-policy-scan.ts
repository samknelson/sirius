/**
 * Task verification: derived election policy — resolver month-correctness +
 * representative scan timing. Usage: npx tsx scripts/oneoffs/verify-derived-policy-scan.ts
 */
import { storage } from "../../server/storage";
import { runBenefitsScan } from "../../server/services/benefits-scan";
import { loadComponentCache } from "../../server/services/component-cache";
import {
  createPolicyResolutionCache,
  resolveEmployerPolicyAsOf,
} from "../../server/services/policy-resolution";

async function main() {
  await loadComponentCache();
  // Worker/employer from the audit with a mid-election employer policy change
  const workerId = "41b8b9ec-8ff9-4294-aeb8-74e9978ca492";
  const employerId = "3f8047ed-ec51-4bfd-b57d-7d54139a967c";

  const cache = createPolicyResolutionCache();
  for (const asOf of ["2026-06-01", "2026-07-01", "2026-08-01"]) {
    const r = await resolveEmployerPolicyAsOf(storage, employerId, asOf, cache);
    console.log(`asOf=${asOf} policy=${r.policy?.name ?? "(none)"} source=${r.policySource}`);
  }

  const elections = await storage.workerTrustElections.search({ limit: 15 });
  const workerIds = Array.from(new Set(elections.map((e) => e.workerId))).slice(0, 10);
  const policyCache = createPolicyResolutionCache();
  const t0 = Date.now();
  for (const wid of workerIds) {
    try {
      const res = await runBenefitsScan(storage, wid, 7, 2026, "test", { policyCache });
      console.log(`worker=${wid} policy=${res.policyName} actions=${res.actions.length}`);
    } catch (e) {
      const el = await storage.workerTrustElections.getActiveByWorkerAsOf(wid, "2026-07-31");
      console.log(`worker=${wid} SCAN-ERROR=${(e as Error).message} activeElection=${el ? `${el.id} employer=${el.employerId} storedPolicy=${el.policyId}` : "none"}`);
    }
  }
  console.log(`Scanned ${workerIds.length} workers in ${Date.now() - t0}ms (test mode, shared cache)`);

  for (const [m, y] of [[6, 2026], [7, 2026]] as const) {
    const res = await runBenefitsScan(storage, workerId, m, y, "test", {});
    console.log(`mid-change worker month=${y}-${m} policy=${res.policyName}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

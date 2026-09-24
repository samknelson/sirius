/**
 * One-off smoke test for the dispatch_primary_unavailable denorm plugin.
 * Imports the plugin file directly (not the denorm barrel, which pulls the
 * whole PluginRegistry init chain into a standalone script).
 * Run: npx tsx scripts/oneoffs/smoke-primary-unavailable.ts
 */
import { storage } from "../../server/storage";
import { createWorkerDispatchStatusStorage } from "../../server/storage/dispatch/worker-status";
import { dispatchPrimaryUnavailableDenormPlugin as plugin } from "../../server/plugins/system/denorm/plugins/dispatch/primary-unavailable";

async function main() {
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "dispatch_primary_unavailable");
  console.log("config:", configs[0]?.id, "enabled:", configs[0]?.enabled);
  if (!configs[0]) throw new Error("no config seeded");

  const candidates = await storage.dispatches.findWorkerIdsWithAcceptedPrimaryMissingDenorm(configs[0].id, 5);
  console.log("backfill candidates (accepted+primary, no denorm row):", candidates);

  const all = await storage.dispatches.getAll();
  const primary = all.find((d) => d.status === "accepted" && d.isPrimary);
  if (!primary) {
    console.log("No accepted+primary dispatch in dev DB; compute/write smoke skipped.");
    return;
  }
  const workerId = primary.workerId;

  const statusStorage = createWorkerDispatchStatusStorage();
  const before = await statusStorage.getByWorker(workerId);
  console.log("worker:", workerId, "status before:", before?.status ?? "(none)");

  const payload = await plugin.compute(workerId);
  console.log("compute payload:", payload);

  await plugin.write(workerId, payload, "smoke-denorm-row-id");
  const after = await statusStorage.getByWorker(workerId);
  console.log("status after write:", after?.status ?? "(none)");

  // Re-run write to prove the convergent no-op path.
  await plugin.write(workerId, payload, "smoke-denorm-row-id");
  console.log("second write completed (should have been a no-op)");

  // Negative case: a worker with no accepted primary must never be touched.
  const nonPrimary = all.find((d) => !(d.status === "accepted" && d.isPrimary) && d.workerId !== workerId);
  if (nonPrimary) {
    const w2 = nonPrimary.workerId;
    const b2 = await statusStorage.getByWorker(w2);
    const p2 = await plugin.compute(w2);
    await plugin.write(w2, p2, "smoke-denorm-row-id");
    const a2 = await statusStorage.getByWorker(w2);
    console.log("negative-case worker:", w2, "payload:", p2, "before:", b2?.status ?? "(none)", "after:", a2?.status ?? "(none)");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

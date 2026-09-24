/**
 * One-off smoke test for the dispatch_asi (Auto Sign-In) denorm plugin.
 * Imports the plugin file directly (not the denorm barrel, which pulls the
 * whole PluginRegistry init chain into a standalone script).
 * Run: npx tsx scripts/oneoffs/smoke-dispatch-asi.ts
 */
import { storage } from "../../server/storage";
import { createWorkerDispatchAsiStorage } from "../../server/storage/dispatch/worker-asi";
import { createWorkerDispatchStatusStorage } from "../../server/storage/dispatch/worker-status";
import { dispatchAsiSignInDenormPlugin as plugin } from "../../server/plugins/system/denorm/plugins/dispatch/asi-sign-in";

async function main() {
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "dispatch_asi");
  console.log("config:", configs[0]?.id, "enabled:", configs[0]?.enabled);
  if (!configs[0]) throw new Error("no config seeded");

  const all = await storage.dispatches.getAll();
  const primary = all.find((d) => d.isPrimary);
  if (!primary) {
    console.log("No primary dispatch in dev DB; write smoke skipped.");
    return;
  }
  const workerId = primary.workerId;
  const asiStorage = createWorkerDispatchAsiStorage();
  const statusStorage = createWorkerDispatchStatusStorage();

  // Preserve current state to restore at the end.
  const asiBefore = await asiStorage.getByWorker(workerId);
  const statusBefore = await statusStorage.getByWorker(workerId);
  console.log("worker:", workerId, "asi:", asiBefore?.asi ?? "(none)", "status:", statusBefore?.status ?? "(none)");

  // compute() must be inert (sweep no-op).
  const sweep = await plugin.compute(workerId);
  console.log("compute payload (must be leftAccepted:false):", sweep);

  const leftAccepted = { leftAccepted: true, dispatchId: primary.id };

  // Case 1: ASI OFF → no change even on a left-accepted primary event.
  await asiStorage.upsertByWorker(workerId, false);
  await statusStorage.upsertByWorker(workerId, { status: "not_available" });
  await plugin.write(workerId, leftAccepted, "smoke-denorm-row-id");
  let s = await statusStorage.getByWorker(workerId);
  console.log("ASI off, leftAccepted primary → status:", s?.status, "(expect not_available)");

  // Case 2: ASI ON → status flips to available.
  await asiStorage.upsertByWorker(workerId, true);
  await plugin.write(workerId, leftAccepted, "smoke-denorm-row-id");
  s = await statusStorage.getByWorker(workerId);
  console.log("ASI on, leftAccepted primary → status:", s?.status, "(expect available)");

  // Case 3: convergent no-op when already available.
  await plugin.write(workerId, leftAccepted, "smoke-denorm-row-id");
  console.log("second write completed (should have been a no-op)");

  // Case 4: sweep payload must NOT undo a manual change.
  await statusStorage.upsertByWorker(workerId, { status: "not_available" });
  await plugin.write(workerId, sweep, "smoke-denorm-row-id");
  s = await statusStorage.getByWorker(workerId);
  console.log("manual not_available + sweep write → status:", s?.status, "(expect not_available)");

  // Case 5: non-primary dispatch → no change.
  const nonPrimary = all.find((d) => !d.isPrimary);
  if (nonPrimary && nonPrimary.workerId === workerId) {
    await plugin.write(workerId, { leftAccepted: true, dispatchId: nonPrimary.id }, "smoke-denorm-row-id");
    s = await statusStorage.getByWorker(workerId);
    console.log("non-primary leftAccepted → status:", s?.status, "(expect not_available)");
  } else if (nonPrimary) {
    const w2 = nonPrimary.workerId;
    const b2 = await statusStorage.getByWorker(w2);
    await plugin.write(w2, { leftAccepted: true, dispatchId: nonPrimary.id }, "smoke-denorm-row-id");
    const a2 = await statusStorage.getByWorker(w2);
    console.log("non-primary worker:", w2, "before:", b2?.status ?? "(none)", "after:", a2?.status ?? "(none)", "(expect unchanged)");
  }

  // Restore original state.
  if (asiBefore) await asiStorage.upsertByWorker(workerId, asiBefore.asi);
  else await asiStorage.upsertByWorker(workerId, false);
  if (statusBefore) await statusStorage.upsertByWorker(workerId, { status: statusBefore.status });
  console.log("restored original asi/status");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

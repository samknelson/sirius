import { syncWorkerEins, parseRemoteWorkerName } from "../../server/modules/sitespecific/t631/client/sync-workers";
import { storage } from "../../server/storage";

async function main() {
  console.log("parse tests:",
    parseRemoteWorkerName("Aery, Lina"),
    parseRemoteWorkerName("Fleming Ii, Victor"),
    parseRemoteWorkerName("Cher"),
    parseRemoteWorkerName("  "),
  );

  const payload = {
    success: true,
    data: {
      workers: [
        { worker_id: "TEST-740-XYZ", worker_ein: "TEST-EIN-740", worker_name: "Testerson, Zed" },
        { worker_id: "TEST-740-NONAME", worker_ein: "TEST-EIN-741", worker_name: "" },
      ],
    },
  };

  const live = await syncWorkerEins(payload as any, false);
  console.log("live result:", JSON.stringify(live, null, 2));

  // Verify + clean up
  const t631TypeId = await storage.workerIds.getTypeIdBySiriusId("t631");
  const einTypeId = await storage.workerIds.getTypeIdBySiriusId("freeman_ein");
  const t631Row = await storage.workerIds.getWorkerIdByTypeAndValue(t631TypeId!, "TEST-740-XYZ");
  if (!t631Row) throw new Error("t631 id row not created");
  const workerId = t631Row.workerId;
  const worker = await storage.workers.getWorker(workerId);
  console.log("created worker:", worker?.id);
  const ids = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
  console.log("id rows:", ids.map(i => ({ typeId: i.typeId, value: i.value })));
  const einRow = ids.find(i => i.typeId === einTypeId && i.value === "TEST-EIN-740");
  if (!einRow) throw new Error("ein row not created");

  // Re-run should be unchanged for the created worker
  const rerun = await syncWorkerEins(payload as any, false);
  console.log("rerun summary:", { workersCreated: rerun.workersCreated, unchanged: rerun.unchanged, skipped: rerun.skipped, errors: rerun.errors });

  // Cleanup
  for (const i of ids) await storage.workerIds.deleteWorkerId(i.id);
  const rerunIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
  for (const i of rerunIds) await storage.workerIds.deleteWorkerId(i.id);
  await storage.workers.deleteWorker(workerId);
  console.log("cleaned up test worker", workerId);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

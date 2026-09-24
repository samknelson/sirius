import { t631Fetch } from "../../server/modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";
import { storage } from "../../server/storage";

const APP_MS = "60e8bf6f-3dc3-4dc8-bce6-06f20bcb440a"; // Apprentice (APP)
const EXB_MS = "4550238a-baa1-412a-85af-cfa70be9b2a6"; // Extraboard (2SHIFT)

function summarize(label: string, r: Awaited<ReturnType<typeof syncWorkerEins>>) {
  const { details, ...counters } = r;
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(counters));
  console.log(details.filter((d) => d.action.includes("status") || d.action.includes("edls") || d.action === "error"));
}

async function main() {
  const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
  if (!fetchResult.success) throw new Error(`fetch failed: ${fetchResult.error}`);
  const data = fetchResult.data as { data: { workers: Record<string, any> | any[] } };
  const rows = Array.isArray(data.data.workers) ? data.data.workers : Object.values(data.data.workers);

  // Find an APP row whose worker exists locally.
  const t631TypeId = await storage.workerIds.getTypeIdBySiriusId("t631");
  let testRow: any = null;
  let workerId = "";
  for (const row of rows) {
    if (String(row.worker_ms).trim() !== "APP") continue;
    const local = await storage.workerIds.getWorkerIdByTypeAndValue(t631TypeId!, String(row.worker_id).trim());
    if (local) { testRow = row; workerId = local.workerId; break; }
  }
  if (!testRow) throw new Error("no APP row with a local worker found");
  console.log("Test worker:", workerId, "remote:", testRow.worker_id);

  const before = {
    edls: await storage.workerEdls.getByWorker(workerId),
    msh: await storage.workerMsh.getWorkerMsh(workerId),
  };
  console.log("Before: edls active =", before.edls?.active, "; msh entries =", before.msh.length);

  const payload = (row: any) => ({ success: true, data: { workers: [row] } }) as any;

  // 1. live: sets Apprentice + EDLS active
  summarize("live: APP", await syncWorkerEins(payload(testRow), false));
  // 2. idempotency: nothing new
  summarize("live again: APP (idempotent)", await syncWorkerEins(payload(testRow), false));
  // 3. same-day switch APP -> 2SHIFT: must UPDATE today's entry, not insert
  summarize("live: 2SHIFT (same-day update)", await syncWorkerEins(payload({ ...testRow, worker_ms: "2SHIFT" }), false));
  // 4. deactivation: worker absent from list (send unrelated row) -> EDLS inactive
  const otherRow = rows.find((r: any) => String(r.worker_id).trim() !== String(testRow.worker_id).trim() && String(r.worker_ms).trim() !== "APP" && String(r.worker_ms).trim() !== "2SHIFT");
  summarize("live: absent -> deactivate", await syncWorkerEins(payload(otherRow), false));

  const after = {
    edls: await storage.workerEdls.getByWorker(workerId),
    msh: await storage.workerMsh.getWorkerMsh(workerId),
    current: await storage.workerMsh.getCurrentMemberStatusIds(workerId),
  };
  console.log("\nAfter: edls active =", after.edls?.active, "; msh entries =", after.msh.length, "; current =", after.current);
  const holders = await storage.workerMsh.getWorkerIdsWithCurrentMs([APP_MS, EXB_MS]);
  console.log("holders of synced statuses:", holders.length);

  // Cleanup: remove msh entries added today by this test; restore EDLS state.
  const today = new Date().toISOString().slice(0, 10);
  const beforeIds = new Set(before.msh.map((m: any) => m.id));
  for (const m of after.msh) {
    if (!beforeIds.has(m.id) && m.date === today) {
      await storage.workerMsh.deleteWorkerMsh(m.id);
      console.log("cleanup: deleted test msh entry", m.id);
    }
  }
  await storage.workerEdls.setActive(workerId, before.edls?.active ?? false);
  console.log("cleanup: restored edls active =", before.edls?.active ?? false);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

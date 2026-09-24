import { t631Fetch } from "../../server/modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";
import { storage, createCommSmsOptinStorage } from "../../server/storage";

const TARGET_REMOTE_ID = "OA989593";

async function main() {
  const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
  if (!fetchResult.success) {
    console.error("T631 fetch failed:", fetchResult.error);
    process.exit(1);
  }
  const body = fetchResult.data as { success: boolean; data: { workers: unknown } };
  const rawWorkers = body.data.workers;
  const rows = Array.isArray(rawWorkers) ? rawWorkers : Object.values(rawWorkers as object);
  const row = (rows as Array<{ worker_id?: unknown }>).find(
    (r) => String(r.worker_id) === TARGET_REMOTE_ID,
  );
  if (!row) {
    console.error("Target remote worker not found");
    process.exit(1);
  }
  const payload = { success: true, data: { workers: [row] } } as Parameters<typeof syncWorkerEins>[0];

  console.log("=== LIVE RUN 1 ===");
  const r1 = await syncWorkerEins(payload, false);
  const { details: d1, ...c1 } = r1;
  console.log(JSON.stringify(c1));
  console.log(JSON.stringify(d1, null, 2));

  console.log("=== LIVE RUN 2 (idempotency) ===");
  const r2 = await syncWorkerEins(payload, false);
  const { details: d2, ...c2 } = r2;
  console.log(JSON.stringify(c2));
  console.log(JSON.stringify(d2, null, 2));

  const workerId = d1.find((d) => d.workerId)?.workerId;
  if (workerId) {
    const worker = await storage.workers.getWorker(workerId);
    if (worker) {
      const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(worker.contactId);
      console.log("PHONES NOW:", JSON.stringify(phones.map((p) => ({ id: p.id, phoneNumber: p.phoneNumber, isActive: p.isActive, isPrimary: p.isPrimary })), null, 2));
      const optinStorage = createCommSmsOptinStorage();
      for (const p of phones) {
        const optin = await optinStorage.getSmsOptinByPhoneNumber(p.phoneNumber);
        console.log("OPTIN for", p.phoneNumber, ":", JSON.stringify(optin ?? null));
      }
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

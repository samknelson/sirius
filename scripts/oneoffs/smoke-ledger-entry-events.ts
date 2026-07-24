// Smoke test for LEDGER_ENTRY_SAVED storage-layer emission (Task: auto-queue
// WMB rescans on ledger charge/adjustment changes). Run:
//   npx tsx scripts/oneoffs/smoke-ledger-entry-events.ts
import "../../server/storage/database";
import { storage } from "../../server/storage";
import { eventBus, EventType, type LedgerEntrySavedPayload } from "../../server/services/event-bus";

async function main() {
  const events: LedgerEntrySavedPayload[] = [];
  const handlerId = eventBus.on({
    name: "smoke-ledger-entry-events",
    description: "smoke test collector",
    event: EventType.LEDGER_ENTRY_SAVED,
    handler: async (p) => { events.push(p); },
  });

  // Find a worker-owned EA.
  const eas = await storage.ledger.ea.getAll();
  const workerEa = eas.find(ea => ea.entityType === "worker");
  if (!workerEa) throw new Error("No worker EA found");
  console.log("Using worker EA", workerEa.id, "worker", workerEa.entityId);

  const expect = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    console.log("PASS:", msg);
  };
  const drain = () => new Promise(r => setTimeout(r, 100));

  // 1. create
  const entry = await storage.ledger.entries.create({
    eaId: workerEa.id,
    amount: "12.34",
    chargePlugin: "smoke-test",
    chargePluginKey: `smoke-${Date.now()}-1`,
    category: "adjustment",
    memo: "smoke test entry",
    date: new Date("2026-03-15T00:00:00Z"),
    statementYmd: "2026-03-15",
  } as any);
  await drain();
  expect(events.length === 1 && events[0].operation === "created" && events[0].statementYmd === "2026-03-15" && events[0].entityType === "worker" && events[0].entityId === workerEa.entityId, "create emits created event with statement month");

  // 2. update moving statement month -> 2 events (old + new month)
  events.length = 0;
  await storage.ledger.entries.update(entry.id, { statementYmd: "2026-04-15" } as any);
  await drain();
  const months = events.map(e => e.statementYmd).sort();
  expect(events.length === 2 && events.every(e => e.operation === "updated") && months[0] === "2026-03-15" && months[1] === "2026-04-15", "statement-month move emits both old and new month");

  // 3. update without month move -> 1 event
  events.length = 0;
  await storage.ledger.entries.update(entry.id, { memo: "smoke test entry 2" } as any);
  await drain();
  expect(events.length === 1 && events[0].operation === "updated", "plain update emits one event");

  // 4. delete
  events.length = 0;
  await storage.ledger.entries.delete(entry.id);
  await drain();
  expect(events.length === 1 && events[0].operation === "deleted" && events[0].statementYmd === "2026-04-15", "delete emits deleted event");

  // 5. payment-cascade path: entry with referenceType=payment, then payments.delete
  const fakePaymentId = "00000000-0000-4000-8000-00000000abcd";
  const e2 = await storage.ledger.entries.create({
    eaId: workerEa.id,
    amount: "-5.00",
    chargePlugin: "smoke-test",
    chargePluginKey: `smoke-${Date.now()}-2`,
    category: "payment",
    memo: "smoke cascade entry",
    date: new Date("2026-05-01T00:00:00Z"),
    statementYmd: "2026-05-01",
    referenceType: "payment",
    referenceId: fakePaymentId,
  } as any);
  events.length = 0;
  await storage.ledger.payments.delete(fakePaymentId);
  await drain();
  expect(events.some(e => e.operation === "deleted" && e.entryId === e2.id), "payments.delete cascade emits deleted event for allocation entry");

  eventBus.off(handlerId);
  console.log("ALL PASS");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

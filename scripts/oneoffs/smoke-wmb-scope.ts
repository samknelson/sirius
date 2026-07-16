import { storage } from "../../server/storage";

async function main() {
  const employers = await storage.employers.getAllEmployers();
  const active = employers.filter(e => e.isActive).slice(0, 3);
  for (const emp of active) {
    const ids = await storage.wmbScanQueue.getEmployerWorkerIdsForMonth(emp.id, 6, 2026);
    console.log(`${emp.name}: ${ids.length} workers for 6/2026`);
  }
  const statuses = await storage.wmbScanQueue.getAllMonthStatuses();
  console.log("statuses:", statuses.slice(0, 3).map(s => ({ m: s.month, y: s.year, scope: s.scopeType, emp: s.scopeEmployerName })));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

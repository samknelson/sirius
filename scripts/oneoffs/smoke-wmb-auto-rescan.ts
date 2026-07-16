import { storage } from '../../server/storage';

async function main() {
  const month = 6;
  const year = 2001; // far-past month so we don't disturb real runs
  const all = await storage.workers.getAllWorkers();
  const worker = all[0];
  if (!worker) throw new Error('no worker found');
  console.log('worker:', worker.id);

  // 1. enqueueWorker with auto source
  const entry = await storage.wmbScanQueue.enqueueWorker(worker.id, month, year, 'worker_update');
  console.log('enqueued:', entry.id, entry.status, entry.triggerSource);

  // 2. filtered claim with non-matching source should NOT claim it
  const none = await storage.wmbScanQueue.claimNextJob(['auto_hours_bulk']);
  console.log('claim with wrong source:', none ? `CLAIMED ${none.id} (src=${none.triggerSource})` : 'nothing (expected if only our job pending)');

  // 3. filtered claim with matching source should claim it
  const job = await storage.wmbScanQueue.claimNextJob(['worker_update', 'auto_hours_bulk']);
  console.log('claim with matching source:', job ? `${job.id} src=${job.triggerSource}` : 'NOTHING (unexpected)');

  if (job) {
    await storage.wmbScanQueue.recordJobResult(job.id, true, { smoke: true });
    console.log('job completed');
  }

  // 4. dedupe check: pending entry detection
  await storage.wmbScanQueue.enqueueWorker(worker.id, month, year, 'worker_update');
  const existing = await storage.wmbScanQueue.getWorkerQueueEntry(worker.id, month, year);
  console.log('dedupe lookup:', existing?.status, existing?.triggerSource);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

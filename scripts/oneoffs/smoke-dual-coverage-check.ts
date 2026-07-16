import { storage } from '../../server/storage';

async function main() {
  const elections = await storage.workerTrustElections.search({ activeOnly: true, limit: 5 });
  if (elections.length === 0) {
    console.log('No active elections in dev DB; running empty-input check only.');
  }
  const e = elections[0];
  if (e) {
    // Build a hypothetical new election by ANOTHER subscriber that tries to
    // cover the existing election's subscriber as a dependent — should conflict.
    const rels = await storage.workerRelations.searchWorkerRelations({ workerId: e.workerId });
    console.log('Election subscriber:', e.workerId, 'start:', e.startYmd, 'rels found:', rels.length);
    const rel: any = (rels as any[])[0];
    if (rel) {
      const otherSubscriber = rel.worker1 === e.workerId ? rel.worker2 : rel.worker1;
      const conflicts = await storage.workerTrustElections.checkDualCoverage({
        subscriberId: otherSubscriber,
        relationshipIds: [rel.id],
        startYmd: e.startYmd,
        endYmd: null,
      });
      console.log('Conflicts (expect >=1):', JSON.stringify(conflicts, null, 2));
    } else {
      // Subscriber-as-subscriber conflict: another subscriber overlapping window with no rels
      const conflicts = await storage.workerTrustElections.checkDualCoverage({
        subscriberId: e.workerId,
        relationshipIds: [],
        startYmd: e.startYmd,
        endYmd: null,
      });
      console.log('Own-subscriber check (expect 0, own elections ignored):', conflicts);
    }
  }
  const none = await storage.workerTrustElections.checkDualCoverage({
    subscriberId: '00000000-0000-0000-0000-000000000000',
    relationshipIds: [],
    startYmd: '2026-07-01',
    endYmd: null,
  });
  console.log('Nonexistent subscriber conflicts (expect 0):', none.length);
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });

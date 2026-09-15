# Worker Benefit Role History Corrective-Scan Benchmark

Run: 2026-09-15T18:33:06.149Z
Fixture: 3,000 isolated synthetic workers × 10 benefits = 30,000 WMB actions/case; 12 concurrent per-person scan transactions. Relationship-backed fraction: 0% (own coverage only, to isolate corrective write overhead).

Each person uses the real production scope: `runInTransaction` → `withWmbBenefitRoleHistoryInvalidationBatch` → `withWmbScanWrites` → `runInSavepoint(createWorkerBenefit)` per action. Thus each person commits independently; no case uses an enormous scan transaction. SQL counts are measured by a temporary node-postgres Client.query wrapper during the timed case.

| case | payload rows before | WMB actions | affected workers | status rows | generation delta | elapsed | throughput | measured SQL calls | exact bounded drain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| no-config/fresh | 0 | 30,000 | 0 | 0 | 0 | 23.19 s | 1293.8/s | begin=3000, savepoint=30000, wmbInsert=30000, releaseSavepoint=30000, other=9, configSelect=3000, commit=3000 | not sampled |
| registered/fresh | 0 | 30,000 | 3,000 | 3,000 | 3,000 | 25.86 s | 1159.9/s | begin=3000, savepoint=30000, wmbInsert=30000, releaseSavepoint=30000, configSelect=3000, denormUpsert=3000, commit=3000 | 3000/5,000 limit in 59.82 s; 3,000 payload rows; 598.2 s compute projection for 30,000 rows |
| disabled/payload-populated | 3,000 | 30,000 | 3,000 | 3,000 | 3,000 | 27.02 s | 1110.3/s | begin=3000, savepoint=30000, wmbInsert=30000, releaseSavepoint=30000, other=9, configSelect=3000, denormUpsert=3000, commit=3000 | 3000/5,000 limit in 70.06 s; 3,000 payload rows; 700.6 s compute projection for 30,000 rows |
| registered/payload-populated | 3,000 | 30,000 | 3,000 | 3,000 | 3,000 | 24.12 s | 1244.0/s | begin=3000, savepoint=30000, wmbInsert=30000, releaseSavepoint=30000, other=9, configSelect=3000, denormUpsert=3000, commit=3000 | not sampled |

Baseline semantics: the initial `no-config` case runs before the isolated benchmark config exists, so WMB storage executes its production config lookup, finds no config, and does no enqueue. The script refuses to run if an installed role-history config exists; it creates and removes only its uniquely named fixture config. The disabled case left 3,000 stale status rows (+3,000 generation) while its summary payload was already populated; after re-enable, the real bounded drainer recomputed all 3,000 and retained 3,000 payload rows. This is the disable → mutate → re-enable regression proof; disabled configs deliberately retain pending invalidations.

Drain math: each projection linearly scales one real `recomputeStaleDenorm({ pluginId, limit: 5000 })` run against this isolated 3,000-row config. It does not multiply a multi-pass elapsed time. At a 5,000-row/ten-minute shared tick bound, a 30,000-worker status backlog needs six slots (about 50 minutes until slot six starts), plus its measured final-slice compute time.

Fixture cleanup deletes source WMB, status, payload, workers, contacts, employer, and benefits in finally. Companion integration tests cover own/grantor/dependent/both/backdated/deleted relation semantics, rollback, claim conflict/recovery, rebuild parity, and FK cascades.

---
name: BAO hours upload performance
description: Invariants for the three-axis bulk-upload optimization; what must stay true for correctness.
---

## Invariants

**1. Dirty-set rule**: any worker that has had reconcile+write attempted (even on error) must be in the run-cache `dirty` set before a subsequent duplicate-SSN row runs. Use `try/finally` around the entire write path — not just after success — so a partial write (upserts done, later step throws) still marks the worker dirty.

**Why**: the pre-fetch snapshot reflects DB state at the start of the run. Once any row is written for a worker, the snapshot is stale. A duplicate-SSN row reading the stale snapshot will miss newly-written rows and fail to delete them (e.g. leaving a FMLA day-15 top-up when the duplicate is Active).

**2. skipHomeEmployerEvent is safe only when `home` is never set**: the flag suppresses both pre- and post-upsert `deriveHomeEmployerId` calls. Only pass it from upload paths that never write `home: true`.

**3. chargeConfigCache scope is one run**: `withChargeConfigCache` must wrap the outer processing loop, not individual row handlers. Configs must not be cached across separate uploads (different employers or different processing runs).

**4. withChargeBatchCollector defers all CREATE ledger writes to one bulk INSERT**: installed by `processFeedData` in both `bao_monthly_hours.ts` and `gbhet_legal_workers.ts`. The executor checks `chargeTransactionSink` on the request context; when present it pushes transactions instead of writing immediately. `flush()` runs in a `finally` block so it executes even if the processing loop throws. DELETE paths (non-billed status, `deleteWorkerHours`) are unaffected — they always execute immediately.

**5. EA cache (`ledgerEaCache`) eliminates per-row EA getOrCreate round-trips**: installed by `withChargeBatchCollector`. The plugin's `getOrCreateEaCached` call (to compute `chargePluginKey`) and the collector's flush (to resolve `eaId` for the bulk INSERT) both check this cache first. For a typical BAO upload, all rows share one (employer, account) pair → 1 DB call total regardless of row count.

**6. bulkCreate uses ON CONFLICT DO UPDATE on (chargePlugin, chargePluginKey)**: re-uploading the same hours row overwrites rather than fails. Matches the `getByChargePluginKey` idempotency guarantee of the per-row path. New file: `server/plugins/ledger/charge/charge-batch.ts` (ChargeTransactionCollector + withChargeBatchCollector); `server/plugins/ledger/charge/ea-cache.ts` (getOrCreateEaCached).

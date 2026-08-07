---
name: S1 loader heartbeats & log throttling
description: Progress heartbeats and storage-op log sampling in the S1 migration loaders — env knobs and monitoring implications.
---

All long S1 loaders (contacts-workers, relationships, elections, benefit-history,
payments, ledger, hours, call-logs, enrollment-packet-tags) share the staging
heartbeat (`scripts/s1-migration/lib/progress.ts`) and throttle per-row
"Storage operation" logging via `throttleStorageOpLogs()` (loader-utils →
`setStorageLogSampling` in the storage logging middleware).

**Knobs:**
- `S1_PROGRESS_INTERVAL_MS` — heartbeat interval (default 60s; lower only for dev/smoke).
- `S1_LOADER_LOG_SAMPLE` — 0 = suppress storage-op logs, 1 = full logging, N = 1-in-N per operation (default 500).

**Why:** per-row storage logging cost extra WAN round-trips per write (before-state
read + winston_logs insert) and made long prod loaders unobservable except by
table counts.

**How to apply:**
- `winston_logs` is NOT a progress/volume proxy for loader runs anymore — use
  heartbeat lines (CloudWatch) or plain table counts (RUNBOOK §4.1 block).
- Sampled-out failing storage calls also skip the "Storage operation failed"
  line; RejectLog/report output is the failure surface during loads.
- Heartbeats are aggregates-only (HIPAA); phase lines (`pre-scan`, `flush`,
  `verify`) mean silence > a few minutes = hung connection.
- App server never calls the sampling setter — normal audit logging unchanged.
- Gotcha found here: `Number(undefined ?? "")` is 0 — env-default parsing must
  explicitly treat unset/empty as "use default" or 0-meaning-suppress kicks in.

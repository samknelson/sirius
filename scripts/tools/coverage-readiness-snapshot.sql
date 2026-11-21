-- Authorized read-only diagnostics. No names, source payloads or query text.
-- Capture once at zero and again after recurrence, and retain both timestamps.
-- Correlation is not producer attribution: denorm has no producer-history log.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Compare admin's saved-row count and EDI's worker join in ONE snapshot.
WITH configs AS (
  SELECT id, plugin_id, enabled FROM plugin_configs
  WHERE plugin_kind = 'denorm'
    AND plugin_id IN ('worker-benefit-coverage-spans', 'trust-wmb-terminate')
), admin_counts AS (
  SELECT c.id, count(d.id) AS tracked,
    count(*) FILTER (WHERE d.status = 'ok') AS ok,
    count(*) FILTER (WHERE d.status = 'stale') AS stale,
    count(*) FILTER (WHERE d.status = 'error') AS failed
  FROM configs c LEFT JOIN denorm d ON d.config_id = c.id GROUP BY c.id
), worker_counts AS (
  SELECT c.id, count(w.id) AS population,
    count(*) FILTER (WHERE w.id IS NOT NULL AND d.id IS NULL) AS missing,
    count(*) FILTER (WHERE d.status = 'ok') AS ok,
    count(*) FILTER (WHERE d.status = 'stale') AS stale,
    count(*) FILTER (WHERE d.status = 'error') AS failed
  FROM configs c LEFT JOIN workers w ON true
  LEFT JOIN denorm d ON d.entity_id = w.id AND d.entity_type = 'worker' AND d.config_id = c.id
  GROUP BY c.id
)
SELECT transaction_timestamp() AS observed_at, c.*,
  a.tracked AS admin_tracked, a.ok AS admin_ok, a.stale AS admin_stale, a.failed AS admin_failed,
  w.population, w.missing, w.ok AS edi_ok, w.stale AS edi_stale, w.failed AS edi_failed
FROM configs c JOIN admin_counts a USING (id) JOIN worker_counts w USING (id);

SELECT transaction_timestamp() AS observed_at, c.id AS config_id, c.plugin_id, d.status,
  count(*) AS records, min(d.generation) AS min_generation, max(d.generation) AS max_generation,
  min(d.stale_at) AS oldest_stale, max(d.stale_at) AS newest_stale,
  min(d.computed_at) AS oldest_computed, max(d.computed_at) AS newest_computed,
  count(d.claim_at) AS claimed, min(d.claim_at) AS oldest_claim, max(d.claim_at) AS newest_claim
FROM denorm d JOIN plugin_configs c ON c.id = d.config_id
WHERE c.plugin_kind = 'denorm'
  AND c.plugin_id IN ('worker-benefit-coverage-spans', 'trust-wmb-terminate')
GROUP BY c.id, c.plugin_id, d.status;

SELECT transaction_timestamp() AS observed_at, status, trigger_source,
  count(*) AS jobs, min(picked_at) AS oldest_pick, max(picked_at) AS newest_pick,
  max(completed_at) AS last_completed
FROM trust_wmb_scan_queue
WHERE status IN ('pending', 'processing') OR completed_at >= now() - interval '1 hour'
GROUP BY status, trigger_source;

-- Bounded producer attribution: one cumulative row per config and operation,
-- with no worker ids or source/eligibility payloads. This is not an event log.
SELECT transaction_timestamp() AS observed_at, c.id AS config_id, c.plugin_id,
  w.operation, w.call_count, w.affected_count, w.last_affected_count, w.last_at
FROM coverage_readiness_work w
JOIN plugin_configs c ON c.id = w.config_id
WHERE c.plugin_kind = 'denorm'
  AND c.plugin_id IN ('worker-benefit-coverage-spans', 'trust-wmb-terminate')
ORDER BY c.plugin_id, w.operation;

-- These are saved observations, NOT current maintenance counts.
SELECT transaction_timestamp() AS observed_at,
  data #>> '{config,configId}' AS edi_config_id,
  data #>> '{progress,coverage,status}' AS saved_check_status,
  data #>> '{progress,coverage,startedAt}' AS check_started_at,
  data #>> '{progress,coverage,failedAt}' AS check_failed_at,
  data #>> '{coverageSnapshot,checkedAt}' AS successful_check_at,
  count(*) AS wizard_runs
FROM wizards WHERE type = 'trust_provider_edi'
GROUP BY 2, 3, 4, 5, 6;
ROLLBACK;

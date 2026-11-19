-- Kaiser EDI real-data verification, step 3 of 3: the counts a readiness
-- refusal should name.
--
-- Run in the staging or production database from an authorized SQL console,
-- at the moment the Coverage sources check answers "Coverage lifecycle events
-- are not ready: of N people in this run, ... missing for A people, pending for
-- B people, failed for C people" (or right after a check passes, when every
-- count below should be 0).
-- Read-only and counts only: the result may be shared. It does NOT make
-- maintenance pending; never mark records stale to produce a refusal.
-- Never supply a connection string.
--
-- The counts move while maintenance runs, so compare them with the message
-- only when the two were taken seconds apart.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

-- EDIT: paste the wizard id of the run being checked.
SELECT set_config('edi.run', 'PASTE-RUN-WIZARD-ID', true) AS run;

WITH run AS (
  SELECT w.id, w.data->'input'->>'asOfDate' AS as_of,
         coalesce(w.data->'config'->'data'->>'benefitSiriusId', 'K') AS benefit_sirius_id,
         -- Saved run settings; a run's own settings win over configuration.
         coalesce((w.data->'terminationPolicy'->>'explicitSubscriberTerminations')::boolean,
                  (w.data->'config'->'data'->>'explicitSubscriberTerminations')::boolean, false) AS subscribers,
         coalesce((w.data->'terminationPolicy'->>'explicitDependentTerminations')::boolean,
                  (w.data->'config'->'data'->>'explicitDependentTerminations')::boolean, false) AS dependents,
         coalesce((w.data->'terminationPolicy'->>'terminationLookbackMonths')::int,
                  (w.data->'config'->'data'->>'terminationLookbackMonths')::int, 1) AS lookback
  FROM public.wizards w
  WHERE w.id = current_setting('edi.run') AND w.type = 'trust_provider_edi'
), scope AS (
  SELECT r.*, (r.subscribers OR r.dependents) AS terminations,
         left(r.as_of, 4)::int * 12 + substr(r.as_of, 6, 2)::int - 1 AS report_idx
  FROM run r
), population AS (
  -- Everyone with a coverage record for the benefit in the reporting month,
  -- widened to the lookback months when the run reports endings.
  SELECT DISTINCT w.worker_id
  FROM scope s
  JOIN public.trust_benefits b ON b.sirius_id = s.benefit_sirius_id
  JOIN public.trust_wmb w ON w.benefit_id = b.id
    AND w.year * 12 + w.month - 1 BETWEEN s.report_idx - CASE WHEN s.terminations THEN s.lookback ELSE 0 END AND s.report_idx
), maintenance AS (
  SELECT c.plugin_id, c.id, c.enabled
  FROM public.plugin_configs c, scope s
  WHERE c.plugin_kind = 'denorm'
    AND (c.plugin_id = 'trust-wmb-restart' OR (s.terminations AND c.plugin_id = 'trust-wmb-terminate'))
)
SELECT current_database() AS database_name, now() AS counted_at,
       s.as_of, s.benefit_sirius_id, s.terminations AS reports_endings, s.lookback AS lookback_months,
       m.plugin_id AS maintenance, m.enabled AS maintenance_enabled,
       (SELECT count(*) FROM population) AS people_in_run,
       (SELECT count(*) FROM population p
         WHERE NOT EXISTS (SELECT 1 FROM public.denorm d WHERE d.entity_id = p.worker_id AND d.config_id = m.id)) AS missing,
       (SELECT count(*) FROM population p JOIN public.denorm d ON d.entity_id = p.worker_id AND d.config_id = m.id
         WHERE d.status = 'stale') AS pending,
       (SELECT count(*) FROM population p JOIN public.denorm d ON d.entity_id = p.worker_id AND d.config_id = m.id
         WHERE d.status = 'error') AS failed
FROM scope s LEFT JOIN maintenance m ON true
ORDER BY m.plugin_id;

ROLLBACK;

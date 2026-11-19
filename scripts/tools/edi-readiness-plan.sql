-- Run in the affected database using an authorized SQL console.
-- This outer diagnostic is read-only and plan-only. The returned sql_to_run
-- script DOES execute the REPAIRED aggregate for timing, read-only, with the
-- same ten-second timeout. Neither script changes coverage or makes a file.
-- Return all result sets AND NOTICE messages. Never supply a connection string.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL client_min_messages = 'notice';

SELECT current_database() AS database_name, version() AS database_version;
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('work_mem', 'max_parallel_workers_per_gather', 'jit',
               'statement_timeout', 'lock_timeout', 'random_page_cost');
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'trust_wmb' AND column_name IN ('worker_id', 'benefit_id', 'year', 'month'))
    OR (table_name = 'denorm' AND column_name IN ('entity_id', 'config_id', 'status')));
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('trust_wmb', 'denorm');
SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze
FROM pg_stat_user_tables WHERE schemaname = 'public'
  AND relname IN ('trust_wmb', 'denorm');

-- If your console hides NOTICE messages, copy and execute sql_to_run from
-- this result. It measures the repaired query as ordinary JSON rows, with
-- exact constants for the reported two-config population.
SELECT format($query$
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
WITH population AS (
  SELECT DISTINCT w.worker_id FROM public.trust_wmb w
  WHERE w.benefit_id IN (%L)
    AND w.year = 2026 AND w.month IN (10, 11)
)
SELECT c.config_id, count(*)::int AS population,
  (count(*) FILTER (WHERE d.id IS NULL))::int AS missing,
  (count(*) FILTER (WHERE d.status = 'stale'))::int AS pending,
  (count(*) FILTER (WHERE d.status = 'error'))::int AS failed
FROM population p CROSS JOIN (VALUES (%L), (%L)) c(config_id)
LEFT JOIN public.denorm d ON d.entity_id = p.worker_id AND d.config_id = c.config_id
GROUP BY c.config_id;
ROLLBACK;
$query$,
  (SELECT id FROM public.trust_benefits WHERE sirius_id = 'CARELONEAP'),
  (SELECT id FROM public.plugin_configs WHERE plugin_kind = 'denorm'
    AND plugin_id = 'trust-wmb-restart' AND enabled),
  (SELECT id FROM public.plugin_configs WHERE plugin_kind = 'denorm'
    AND plugin_id = 'trust-wmb-terminate' AND enabled)
) AS sql_to_run;

-- Build the same constant-valued query shape as the application, rather than
-- replacing its config VALUES with a subquery that could change the plan.
-- No ANALYZE: these EXPLAINs plan the statements but do not execute them.
DO $diagnostic$
DECLARE
  benefit varchar;
  restart_config varchar;
  terminate_config varchar;
  config_values text;
  plan_line record;
  both_configs boolean;
  maintenance_config varchar;
BEGIN
  SELECT id INTO STRICT benefit FROM public.trust_benefits WHERE sirius_id = 'CARELONEAP';
  SELECT id INTO STRICT restart_config FROM public.plugin_configs
    WHERE plugin_kind = 'denorm' AND plugin_id = 'trust-wmb-restart' AND enabled;
  SELECT id INTO STRICT terminate_config FROM public.plugin_configs
    WHERE plugin_kind = 'denorm' AND plugin_id = 'trust-wmb-terminate' AND enabled;
  FOREACH maintenance_config IN ARRAY ARRAY[restart_config, terminate_config] LOOP
    RAISE NOTICE 'Site-wide maintenance status plan';
    FOR plan_line IN EXECUTE format(
      'EXPLAIN (COSTS ON, VERBOSE OFF) SELECT status, count(*)::int FROM public.denorm WHERE config_id = %L GROUP BY status',
      maintenance_config)
    LOOP
      RAISE NOTICE '%', plan_line."QUERY PLAN";
    END LOOP;
  END LOOP;
  -- Saved as-of date: 2026-11-15; lookback 1 means October–November.
  FOREACH both_configs IN ARRAY ARRAY[false, true] LOOP
    config_values := format('(%L)', restart_config);
    IF both_configs THEN
      config_values := config_values || format(', (%L)', terminate_config);
    END IF;
    RAISE NOTICE 'Readiness aggregate: include termination config = %', both_configs;
    FOR plan_line IN EXECUTE format($query$
      EXPLAIN (COSTS ON, VERBOSE OFF)
      WITH population AS (
        SELECT DISTINCT w.worker_id FROM public.trust_wmb w
        WHERE w.benefit_id IN (%L)
          AND w.year BETWEEN 2026 AND 2026
          AND w.year * 12 + w.month - 1 BETWEEN 24321 AND 24322
      )
      SELECT c.config_id, count(*)::int AS population,
        (count(*) FILTER (WHERE d.id IS NULL))::int AS missing,
        (count(*) FILTER (WHERE d.status = 'stale'))::int AS pending,
        (count(*) FILTER (WHERE d.status = 'error'))::int AS failed
      FROM population p CROSS JOIN (VALUES %s) c(config_id)
      LEFT JOIN public.denorm d ON d.entity_id = p.worker_id AND d.config_id = c.config_id
      GROUP BY c.config_id
    $query$, benefit, config_values)
    LOOP
      RAISE NOTICE '%', plan_line."QUERY PLAN";
    END LOOP;
  END LOOP;
END
$diagnostic$;
ROLLBACK;

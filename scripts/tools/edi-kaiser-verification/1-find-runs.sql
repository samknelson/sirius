-- Kaiser EDI real-data verification, step 1 of 3: find the runs to compare.
--
-- Run in the staging or production database from an authorized SQL console.
-- Read-only: it lists Trust Provider EDI wizard runs for the Kaiser file and
-- changes nothing. The result holds run ids, dates and counts only (no member
-- data), so it may be shared outside the database's privacy boundary.
-- Never supply a connection string.
--
-- Use the result to pick:
--   * the OLD run: the latest row for the month under test whose
--     start_dates_from is 'history scan (old rule)' and saved_file_rows > 0;
--   * a run with saved_manual_decisions > 0 for the read-only walkthrough;
--   * later, the NEW run you generate for the same as-of month.
-- Do NOT press Generate on the old run: regenerating replaces its saved rows
-- with rows made under the current rule, and the baseline is lost.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

SELECT current_database() AS database_name, now() AS checked_at;

SELECT w.id AS wizard_id,
       w.date AS created,
       w.status,
       w.data->'config'->>'name' AS config_name,
       w.data->'input'->>'asOfDate' AS as_of_date,
       w.data->'reportMeta'->>'generatedAt' AS generated_at,
       w.data->'progress'->'run'->>'status' AS run_status,
       (SELECT count(*) FROM public.wizard_report_data r
         WHERE r.wizard_id = w.id AND r.pk NOT LIKE 'coverage-entry:%') AS saved_file_rows,
       CASE WHEN jsonb_typeof(w.data->'reportMeta') IS DISTINCT FROM 'object' THEN 'not generated'
            WHEN w.data->'reportMeta'->'coverage'->>'exclusionDigest' IS NOT NULL THEN 'lifecycle events (new rule)'
            ELSE 'history scan (old rule)' END AS start_dates_from,
       w.data->'reportMeta'->'coverage'->>'exclusionCount' AS exclusions,
       w.data->'reportMeta'->'coverage'->>'warningCount' AS warnings,
       CASE WHEN jsonb_typeof(w.data->'reportMeta'->'coverageDecisions') = 'array'
              THEN jsonb_array_length(w.data->'reportMeta'->'coverageDecisions')
            WHEN jsonb_typeof(w.data->'coverageDecisions') = 'array'
              THEN jsonb_array_length(w.data->'coverageDecisions')
            ELSE 0 END AS saved_manual_decisions,
       coalesce(w.data->'reportMeta'->'terminationPolicy', w.data->'terminationPolicy') AS termination_settings,
       w.data->'delivery'->>'deliveredAt' AS delivered_at,
       w.data->>'retention' AS retention
FROM public.wizards w
WHERE w.type = 'trust_provider_edi'
  AND w.data->'config'->>'pluginId' = 'sitespecific-bao-kaiser'
ORDER BY w.date DESC
LIMIT 100;

ROLLBACK;

-- Discovery only. Run on the REAL staged S2 target, inside its approved boundary.
-- UPDATE 2026-11-19: partial results are now recorded in the design report.
-- Do not rerun this entire pack. Q5 is withdrawn (disabled below): target/unit
-- profiling remained too expensive even after a reformulation. Missing Q6/Q7
-- results are blockers, not permission for unbounded queries or repeated scans.
-- No loader imports, bootstrap, DDL, repair, recalculation, or data writes.
-- Run Q0 separately FIRST. Q3 requires PostgreSQL 16+ pg_input_is_valid.
-- Stop on a missing relation/function, error, or timeout; do not create anything.
-- Keep all errors private: a JSON parser error can quote a sensitive payload.
-- Share successful result grids only, labelled Q0...Q7; no raw rows or EXPLAIN ANALYZE.
-- Review privately that current_database() names the intended target; do not paste it.

-- Q0: private target check, then share ONLY the second result grid.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SELECT current_database() AS private_target_check;
SELECT current_setting('server_version_num')::integer AS postgres_version,
       to_regclass('s1_staging.raw_ledger_ar') IS NOT NULL AS has_staged_ar,
       to_regclass('s1_staging.records') IS NOT NULL AS has_staged_nodes,
       to_regclass('s1_staging.id_map') IS NOT NULL AS has_crosswalk,
       to_regclass('plugin_configs_charge') IS NOT NULL AS has_charge_configs;
ROLLBACK;

-- Q1: checkpoint completeness and sign/status census; never prints raw status.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SELECT count(*) AS staged_rows, min(extracted_at) AS oldest_extract,
       max(extracted_at) AS newest_extract,
       count(*) FILTER (WHERE content_hash IS NULL) AS missing_hash
FROM s1_staging.raw_ledger_ar;
WITH a AS (
  SELECT CASE WHEN lower(trim(coalesce(ledger_status,''))) = 'cleared'
              THEN 'cleared' ELSE 'not_cleared' END AS status_class,
         CASE WHEN trim(ledger_amount) ~ '^-?[0-9]+([.][0-9]{1,2})?$'
              THEN trim(ledger_amount)::numeric END AS amount
  FROM s1_staging.raw_ledger_ar
)
SELECT status_class,
       CASE WHEN amount IS NULL THEN 'invalid_or_missing'
            WHEN amount < 0 THEN 'negative' WHEN amount = 0 THEN 'zero'
            ELSE 'positive' END AS sign_class,
       count(*) AS rows
FROM a GROUP BY 1,2 ORDER BY 1,2;
ROLLBACK;

-- Q2: source key STRUCTURE only, reference/participant bundles and account.
-- A = an ASCII letter run, N = digit run, X = any other run.
-- No literal prefix, punctuation, memo, name, NID, or JSON value is returned.
-- This is NOT a family classifier: matching shapes do not prove matching meaning.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH bundles AS (
  SELECT nid, CASE WHEN count(*) = 1 THEN min(bundle)
                   ELSE 'AMBIGUOUS_BUNDLE' END AS bundle
  FROM s1_staging.records GROUP BY nid
), a AS (
  SELECT ledger_account,
         CASE WHEN ledger_key IS NULL THEN 'null'
              WHEN ledger_key = '' THEN 'empty'
              ELSE regexp_replace(regexp_replace(regexp_replace(
                ledger_key, '[A-Za-z]+', 'A', 'g'),
                '[0-9]+', 'N', 'g'), '[^AN]+', 'X', 'g') END AS key_shape,
         CASE WHEN trim(ledger_amount) ~ '^-?[0-9]+([.][0-9]{1,2})?$'
              THEN trim(ledger_amount)::numeric END AS amount,
         coalesce(r.bundle, 'NOT_STAGED') AS reference_bundle,
         coalesce(p.bundle, 'NOT_STAGED') AS participant_bundle
  FROM s1_staging.raw_ledger_ar a
  LEFT JOIN bundles r ON r.nid = a.ledger_reference
  LEFT JOIN bundles p ON p.nid = a.ledger_participant
  WHERE lower(trim(coalesce(ledger_status,''))) = 'cleared'
)
SELECT ledger_account AS fund_account_nid, key_shape, reference_bundle,
       participant_bundle,
       CASE WHEN amount IS NULL THEN 'invalid_or_missing'
            WHEN amount < 0 THEN 'negative' WHEN amount = 0 THEN 'zero'
            ELSE 'positive' END AS sign_class,
       count(*) AS rows, sum(amount * 100)::text AS aggregate_cents
FROM a GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5;
ROLLBACK;

-- Q3: JSON validity and candidate discriminator availability, NOT their values.
-- PostgreSQL 16+ only. Names below are probes, NOT observed S1 field contracts.
-- Unknown/dynamic JSON keys are counted, never emitted (keys can contain PII).
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH j AS (
  SELECT CASE WHEN nullif(trim(ledger_json),'') IS NULL THEN 'empty'
              WHEN pg_input_is_valid(ledger_json, 'jsonb') THEN 'valid'
              ELSE 'invalid' END AS validity,
         CASE WHEN pg_input_is_valid(ledger_json, 'jsonb')
              THEN ledger_json::jsonb END AS payload
  FROM s1_staging.raw_ledger_ar
)
SELECT validity, coalesce(jsonb_typeof(payload), 'none') AS root_type,
       count(*) AS rows FROM j GROUP BY 1,2 ORDER BY 1,2;
WITH j AS (
  SELECT CASE WHEN pg_input_is_valid(ledger_json, 'jsonb')
              THEN ledger_json::jsonb END AS payload
  FROM s1_staging.raw_ledger_ar
), fields AS (
  SELECT k, v FROM j CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(payload) = 'object' THEN payload ELSE '{}'::jsonb END
  ) AS e(k,v)
)
SELECT CASE WHEN k IN ('type','plugin','charge_type','source','reference','month')
            THEN k ELSE 'OTHER_REVIEW_PRIVATELY' END AS field_probe,
       jsonb_typeof(v) AS value_type, count(*) AS occurrences,
       count(DISTINCT v) AS distinct_values
FROM fields GROUP BY 1,2 ORDER BY 1,2;
ROLLBACK;

-- Q4: repeated key/reference bundles. Group identities stay inside the DB.
-- A repeated key or reference is a collision signal, not proof of duplication.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH g AS (
  SELECT count(*) AS n, count(DISTINCT ledger_account) AS accounts,
         count(DISTINCT ledger_participant) AS participants,
         count(DISTINCT ledger_reference) AS refs
  FROM s1_staging.raw_ledger_ar
  WHERE nullif(trim(ledger_key),'') IS NOT NULL
  GROUP BY ledger_key
)
SELECT count(*) AS distinct_nonblank_keys,
       count(*) FILTER (WHERE n > 1) AS repeated_keys,
       coalesce(sum(n) FILTER (WHERE n > 1),0) AS rows_on_repeated_keys,
       count(*) FILTER (WHERE accounts > 1) AS multi_account_keys,
       count(*) FILTER (WHERE participants > 1) AS multi_participant_keys,
       count(*) FILTER (WHERE refs > 1) AS multi_reference_keys
FROM g;
WITH g AS (
  SELECT count(*) AS n
  FROM s1_staging.raw_ledger_ar
  WHERE lower(trim(coalesce(ledger_status,''))) = 'cleared'
  GROUP BY ledger_account, ledger_participant, ledger_reference
)
SELECT CASE WHEN n = 1 THEN 'one' WHEN n = 2 THEN 'two' ELSE 'three_or_more' END AS rows_per_bundle,
       count(*) AS bundles, sum(n) AS rows FROM g GROUP BY 1 ORDER BY 1;
ROLLBACK;

/*
Q5 WITHDRAWN. Do not execute/uncomment without a separately reviewed query plan
and small, explicit source-ID scope. No target/unit/config result was returned.

-- Q5: many payperiods -> one monthly hours row, missing/dangling maps,
-- plus candidate config cardinality using executor's account override merge.
-- Does NOT prove family, participant identity, status/rate applicability or
-- historical config authority; config settings remain private.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH p AS (
  SELECT a.ledger_id, a.ledger_account, a.ledger_reference,
         m.s2_id AS hours_id, h.id AS live_hours_id, h.employer_id,
         am.s2_id AS account_id
  FROM s1_staging.raw_ledger_ar a
  JOIN s1_staging.records r ON r.nid = a.ledger_reference AND r.bundle = 'sirius_payperiod'
  LEFT JOIN s1_staging.id_map m ON m.entity = 'payperiod' AND m.s1_id = r.nid
  LEFT JOIN worker_hours h ON h.id = m.s2_id
  LEFT JOIN s1_staging.id_map am ON am.entity = 'ledger-account' AND am.s1_id = a.ledger_account
  WHERE lower(trim(coalesce(a.ledger_status,''))) = 'cleared'
), candidates AS (
  SELECT p.*, (
    SELECT count(*) FROM plugin_configs c
    JOIN plugin_configs_charge s ON s.id = c.id
    WHERE c.plugin_kind = 'charge' AND c.plugin_id = 'bao-hourly'
      AND c.enabled AND s.account = p.account_id
      AND (s.scope = 'employer' AND s.employer_id = p.employer_id
        OR s.scope = 'global' AND NOT EXISTS (
          SELECT 1 FROM plugin_configs ec JOIN plugin_configs_charge es ON es.id = ec.id
          WHERE ec.plugin_kind = 'charge' AND ec.plugin_id = 'bao-hourly'
            AND ec.enabled AND es.scope = 'employer'
            AND es.employer_id = p.employer_id AND es.account = s.account
        ))
  ) AS candidate_count FROM p
)
SELECT CASE WHEN hours_id IS NULL THEN 'missing_crosswalk'
            WHEN live_hours_id IS NULL THEN 'dangling_crosswalk'
            WHEN account_id IS NULL THEN 'unmapped_account'
            WHEN candidate_count = 0 THEN 'zero_configs'
            WHEN candidate_count = 1 THEN 'one_config_NOT_YET_PROVEN'
            ELSE 'multiple_configs' END AS classification,
       count(*) AS rows FROM candidates GROUP BY 1 ORDER BY 1;
WITH g AS (
  SELECT m.s2_id, a.ledger_account,
         count(*) AS ar_rows, count(DISTINCT a.ledger_reference) AS payperiods
  FROM s1_staging.raw_ledger_ar a
  JOIN s1_staging.id_map m ON m.entity = 'payperiod' AND m.s1_id = a.ledger_reference
  WHERE lower(trim(coalesce(a.ledger_status,''))) = 'cleared'
  GROUP BY m.s2_id, a.ledger_account
)
SELECT CASE WHEN payperiods = 1 THEN 'one' ELSE 'multiple' END AS payperiods_per_month,
       CASE WHEN ar_rows = 1 THEN 'one' ELSE 'multiple' END AS ar_rows_per_month,
       count(*) AS monthly_account_groups FROM g GROUP BY 1,2 ORDER BY 1,2;
ROLLBACK;
*/

-- Q6: target provenance health, attribution state, native/import overlap.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SELECT CASE WHEN charge_plugin = 's1-import' THEN 'legacy'
            ELSE 'already_other_owner_REVIEW' END AS owner_class,
       count(*) AS rows,
       count(*) FILTER (WHERE coalesce(data->>'s1LedgerId','') !~ '^[0-9]+$') AS bad_source_id,
       count(*) FILTER (WHERE charge_plugin_config_id IS NULL) AS no_config
FROM ledger WHERE data->>'source' = 's1-migration' GROUP BY 1 ORDER BY 1;
WITH g AS (
  SELECT data->>'s1LedgerId' AS source_id, count(*) AS n FROM ledger
  WHERE data->>'source' = 's1-migration' AND data ? 's1LedgerId'
  GROUP BY 1
)
SELECT count(*) FILTER (WHERE n > 1) AS duplicated_source_identities,
       coalesce(sum(n) FILTER (WHERE n > 1),0) AS rows_on_duplicates FROM g;
WITH g AS (
  SELECT reference_id, ea_id,
         count(*) FILTER (WHERE charge_plugin = 's1-import') AS imported,
         count(*) FILTER (WHERE charge_plugin = 'bao-hourly') AS native
  FROM ledger WHERE reference_type IN ('hour','hour_adjustment')
  GROUP BY reference_id, ea_id
)
SELECT count(*) FILTER (WHERE imported > 0) AS imported_groups,
       count(*) FILTER (WHERE imported > 0 AND native > 0) AS mixed_groups,
       count(*) FILTER (WHERE imported > 1) AS multiple_imported_base_groups
FROM g;
ROLLBACK;

-- Q7: known BAO config inventory; no config names, settings or employer IDs.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SELECT c.plugin_id, c.enabled, s.scope, s.account AS fund_account_id, count(*) AS configs
FROM plugin_configs c JOIN plugin_configs_charge s ON s.id = c.id
WHERE c.plugin_kind = 'charge' AND c.plugin_id IN (
  'bao-hourly','sitespecific-bao-premium','sitespecific-bao-dp',
  'sitespecific-bao-cobra','sitespecific-bao-echp','sitespecific-bao-ee-contribution'
)
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;
ROLLBACK;

-- Follow-up to the operator's 2026-11-19 aggregate results.
-- F1/F2 results have been received. Do not rerun for this design.
-- F3 was withdrawn after timeout and an operator-cancelled unbounded retry.
-- Its attempted SQL is preserved below inside a BLOCK COMMENT, NOT executable.
-- Do not uncomment it or remove timeouts to finish discovery.
-- SELECT-only: no bootstrap, decoding, plugin calls, DDL, or data mutations.
-- Keep timeouts. On timeout/error: ROLLBACK; report the query label and stop.
-- Do not paste payloads, key tokens, node fields, or database names.
-- These probes establish structure, not charge-family meaning.

-- F1: encoding candidates for ledger_json; never emit the underlying text.
-- A PHP/base64/hex-looking prefix is NOT validation of that encoding.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH p AS (
  SELECT trim(ledger_json) AS payload FROM s1_staging.raw_ledger_ar
)
SELECT CASE
  WHEN payload IS NULL OR payload = '' THEN 'empty'
  WHEN payload = 'N;' THEN 'php_null_signature'
  WHEN payload ~ '^a:[0-9]+:[{]' THEN 'php_array_signature'
  WHEN payload ~ '^[OC]:[0-9]+:' THEN 'php_object_signature_DO_NOT_UNSERIALIZE'
  WHEN payload ~ '^s:[0-9]+:"' THEN 'php_string_signature'
  WHEN payload ~ '^[bid]:[^;]*;' THEN 'php_scalar_signature'
  WHEN payload LIKE '{&quot;%' OR payload LIKE '[&quot;%'
    THEN 'html_entity_json_signature'
  WHEN left(payload, 1) = '"' THEN 'quoted_text_signature'
  WHEN payload ~ '^[0-9A-Fa-f]+$' AND length(payload) % 2 = 0
    THEN 'hex_shaped_NOT_PROOF'
  WHEN payload ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(payload) % 4 = 0
    THEN 'base64_shaped_NOT_PROOF'
  ELSE 'other_requires_private_producer_review'
END AS encoding_probe, count(*) AS rows,
       min(length(payload)) AS min_chars, max(length(payload)) AS max_chars
FROM p GROUP BY 1 ORDER BY 1;
ROLLBACK;

-- F2: test relationships without printing keys or their components.
-- No delimiter semantics are assumed for numeric/non-numeric/numeric structures.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
WITH p AS (
  SELECT ledger_account,
         CASE WHEN ledger_key ~ '^[0-9]+$' THEN 'numeric'
              WHEN ledger_key ~ '^[0-9]+[^0-9]+[0-9]+[^0-9]+[0-9]+$'
                THEN 'three_numeric_tokens'
              ELSE 'other_or_blank' END AS shape,
         ledger_key, ledger_reference, ledger_participant,
         CASE WHEN ledger_key ~ '^[0-9]+[^0-9]+[0-9]+[^0-9]+[0-9]+$'
              THEN regexp_split_to_array(ledger_key, '[^0-9]+') END AS tokens
  FROM s1_staging.raw_ledger_ar
)
SELECT ledger_account AS fund_account_nid, shape, count(*) AS rows,
       count(*) FILTER (WHERE
         CASE WHEN shape = 'numeric' THEN ledger_key::numeric END
         = ledger_reference) AS numeric_key_equals_reference,
       count(*) FILTER (WHERE
         CASE WHEN shape = 'numeric' THEN ledger_key::numeric END
         = ledger_participant) AS numeric_key_equals_participant,
       count(*) FILTER (WHERE tokens[1] = ledger_reference::text) AS token1_equals_reference,
       count(*) FILTER (WHERE tokens[2] = ledger_reference::text) AS token2_equals_reference,
       count(*) FILTER (WHERE tokens[3] = ledger_reference::text) AS token3_equals_reference,
       count(*) FILTER (WHERE tokens[1] = ledger_participant::text) AS token1_equals_participant,
       count(*) FILTER (WHERE tokens[2] = ledger_participant::text) AS token2_equals_participant,
       count(*) FILTER (WHERE tokens[3] = ledger_participant::text) AS token3_equals_participant
FROM p GROUP BY 1,2 ORDER BY 1,2;
ROLLBACK;

/*
F3 WITHDRAWN: the attempted lower-work formulation below was not fast enough.
It timed out; an unbounded retry never returned and was cancelled/rolled back.
No F3 results exist. Plan-level investigation and an approved small explicit
source-ID range are prerequisites for a future query, not another full retry.

-- F3: attempted lower-work formulation: aggregate AR BEFORE joining staged payperiods;
-- match their indexed (bundle,nid), not a GROUP BY over the entire node stage.
-- Select configs once per employer/account pair, not a correlated scan per AR row.
-- Scalar/array-first references intentionally mirror loader asScalarRef; objects
-- or malformed fields remain unresolved, never guessed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '3s';
WITH ar AS MATERIALIZED (
  SELECT ledger_reference, ledger_account, ledger_participant, count(*) AS ar_rows
  FROM s1_staging.raw_ledger_ar
  WHERE lower(trim(coalesce(ledger_status,''))) = 'cleared'
  GROUP BY 1,2,3
), refs AS MATERIALIZED (
  SELECT ar.*, r.fields,
         CASE WHEN jsonb_typeof(r.fields->'field_sirius_worker') = 'array'
                THEN r.fields->'field_sirius_worker'->>0
              ELSE r.fields->>'field_sirius_worker' END AS worker_nid,
         CASE WHEN jsonb_typeof(r.fields->'field_grievance_shop') = 'array'
                THEN r.fields->'field_grievance_shop'->>0
              ELSE r.fields->>'field_grievance_shop' END AS employer_nid,
         r.fields->>'field_sirius_date_start' AS start_value
  FROM ar JOIN s1_staging.records r
    ON r.bundle = 'sirius_payperiod' AND r.nid = ar.ledger_reference
), resolved AS MATERIALIZED (
  SELECT r.*, m.s2_id AS crosswalk_id, h.id AS hours_id,
         h.employer_id, h.worker_id, h.year, h.month, h.day AS hours_day,
         wm.s2_id AS mapped_worker, em.s2_id AS mapped_employer,
         pm.s2_id AS mapped_participant_employer, am.s2_id AS account_id,
         CASE WHEN r.start_value ~ '^[0-9]{4}-(0[1-9]|1[0-2])'
              THEN left(r.start_value,7) END AS source_month
  FROM refs r
  LEFT JOIN s1_staging.id_map m ON m.entity = 'payperiod' AND m.s1_id = r.ledger_reference
  LEFT JOIN worker_hours h ON h.id = m.s2_id
  LEFT JOIN s1_staging.id_map wm ON wm.entity = 'worker'
    AND wm.s1_id = CASE WHEN r.worker_nid ~ '^[0-9]{1,18}$' THEN r.worker_nid::bigint END
  LEFT JOIN s1_staging.id_map em ON em.entity = 'employer'
    AND em.s1_id = CASE WHEN r.employer_nid ~ '^[0-9]{1,18}$' THEN r.employer_nid::bigint END
  LEFT JOIN s1_staging.id_map pm ON pm.entity = 'employer' AND pm.s1_id = r.ledger_participant
  LEFT JOIN s1_staging.id_map am ON am.entity = 'ledger-account' AND am.s1_id = r.ledger_account
), pairs AS (
  SELECT DISTINCT employer_id, account_id FROM resolved
  WHERE hours_id IS NOT NULL AND account_id IS NOT NULL
), configs AS MATERIALIZED (
  SELECT c.id, s.scope, s.employer_id, s.account
  FROM plugin_configs c JOIN plugin_configs_charge s ON s.id = c.id
  WHERE c.plugin_kind = 'charge' AND c.plugin_id = 'bao-hourly' AND c.enabled
), counts AS (
  SELECT p.employer_id, p.account_id, count(c.id) AS n
  FROM pairs p LEFT JOIN configs c ON c.account = p.account_id AND (
    c.scope = 'employer' AND c.employer_id = p.employer_id
    OR c.scope = 'global' AND NOT EXISTS (
      SELECT 1 FROM configs e WHERE e.scope = 'employer'
        AND e.employer_id = p.employer_id AND e.account = c.account
    )
  )
  GROUP BY 1,2
), classified AS (
  SELECT r.ledger_account, r.ar_rows, CASE
    WHEN crosswalk_id IS NULL THEN 'missing_crosswalk'
    WHEN hours_id IS NULL THEN 'dangling_crosswalk'
    WHEN mapped_worker IS NULL OR mapped_employer IS NULL OR source_month IS NULL
      THEN 'source_coordinate_unresolved'
    WHEN hours_day IS DISTINCT FROM 1
      OR mapped_worker <> worker_id OR mapped_employer <> r.employer_id
      OR source_month <> (r.year::text || '-' || lpad(r.month::text,2,'0'))
      THEN 'crosswalk_coordinate_mismatch'
    WHEN mapped_participant_employer IS NULL THEN 'not_proven_employer_participant'
    WHEN mapped_participant_employer <> r.employer_id THEN 'participant_employer_mismatch'
    WHEN r.account_id IS NULL THEN 'unmapped_account'
    WHEN coalesce(c.n,0) = 0 THEN 'zero_hourly_configs'
    WHEN c.n = 1 THEN 'one_hourly_config_SOURCE_FAMILY_STILL_UNPROVEN'
    ELSE 'multiple_hourly_configs'
  END AS classification
  FROM resolved r LEFT JOIN counts c ON c.employer_id = r.employer_id AND c.account_id = r.account_id
), fan_in AS (
  SELECT ledger_account, hours_id, count(DISTINCT ledger_reference) AS payperiods,
         sum(ar_rows) AS ar_rows
  FROM resolved WHERE hours_id IS NOT NULL GROUP BY 1,2
)
SELECT ledger_account AS fund_account_nid, 'coordinate_config' AS metric,
       classification, count(*) AS groups, sum(ar_rows) AS ar_rows
FROM classified GROUP BY 1,3
UNION ALL
SELECT ledger_account AS fund_account_nid, 'monthly_fan_in' AS metric,
       CASE WHEN payperiods > 1 THEN 'multiple_payperiods' ELSE 'one_payperiod' END
         || CASE WHEN ar_rows > 1 THEN '_multiple_ar_rows' ELSE '_one_ar_row' END,
       count(*) AS groups, sum(ar_rows) AS ar_rows
FROM fan_in GROUP BY 1,3 ORDER BY 1,2,3;
ROLLBACK;
*/

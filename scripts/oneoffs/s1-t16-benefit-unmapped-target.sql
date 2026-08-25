-- T16 benefit_unmapped investigation — S2 rehearsal target
--
-- READ ONLY. Run this against the migration target PostgreSQL database.
-- It uses only the target's persisted staging and loader reports; it does not
-- modify staging, id_map, benefits, or elections.
--
-- The August 25 report's stored samples all named benefit nid 2457521. This
-- script also derives every currently staged election -> benefit reference so
-- the count is not limited to the capped 25 samples.

BEGIN TRANSACTION READ ONLY;

\echo '1) Latest T16 report and stored benefit-unmapped samples'
SELECT id,
       started_at,
       finished_at,
       report->>'loader' AS loader,
       report->'rejectGate'->'counts'->'benefit_unmapped' AS benefit_unmapped_count,
       report->'detail'->'benefitResolution' AS benefit_resolution,
       report->'detail'->'staged' AS staged_elections
  FROM s1_staging.runs
 WHERE report->>'loader' = 't16-elections'
 ORDER BY id DESC
 LIMIT 1;

WITH latest AS (
  SELECT report
    FROM s1_staging.runs
   WHERE report->>'loader' = 't16-elections'
   ORDER BY id DESC
   LIMIT 1
)
SELECT sample->>'nid' AS election_nid,
       sample->>'benefitNid' AS benefit_nid
  FROM latest,
       jsonb_array_elements(
         COALESCE(report->'detail'->'rejectSamples'->'benefit_unmapped', '[]'::jsonb)
       ) AS samples(sample)
 ORDER BY (sample->>'nid')::bigint;

\echo '2) Current target staging status for benefit nid 2457521'
SELECT
  2457521::bigint AS benefit_nid,
  EXISTS (
    SELECT 1
      FROM s1_staging.records
     WHERE bundle = 'sirius_trust_benefit' AND nid = 2457521
  ) AS present_in_staged_benefits,
  EXISTS (
    SELECT 1
      FROM s1_staging.id_map
     WHERE entity = 'benefit' AND s1_id = 2457521
  ) AS present_in_benefit_id_map,
  EXISTS (
    SELECT 1
      FROM trust_benefits
     WHERE sirius_id = '2457521'
  ) AS present_by_target_sirius_id;

\echo '3) Every current staged election -> benefit reference whose S1 benefit is absent from staging'
WITH election_benefit_refs AS (
  SELECT e.nid AS election_nid,
         CASE
           WHEN jsonb_typeof(v) IN ('number', 'string')
             AND (v #>> '{}') ~ '^[0-9]+$'
             THEN (v #>> '{}')::bigint
           WHEN (v->>'target_id') ~ '^[0-9]+$' THEN (v->>'target_id')::bigint
           WHEN (v->>'value') ~ '^[0-9]+$' THEN (v->>'value')::bigint
           WHEN (v->>'tid') ~ '^[0-9]+$' THEN (v->>'tid')::bigint
         END AS benefit_nid,
         e.extracted_at
    FROM s1_staging.records AS e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(e.fields->'field_sirius_trust_benefits')
        WHEN 'array' THEN e.fields->'field_sirius_trust_benefits'
        WHEN 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(e.fields->'field_sirius_trust_benefits')
      END
    ) AS values(v)
   WHERE e.bundle = 'sirius_trust_worker_election'
)
SELECT r.election_nid,
       r.benefit_nid,
       r.extracted_at,
       EXISTS (
         SELECT 1
           FROM s1_staging.records AS b
          WHERE b.bundle = 'sirius_trust_benefit'
            AND b.nid = r.benefit_nid
       ) AS benefit_present_in_staging,
       EXISTS (
         SELECT 1
           FROM s1_staging.id_map AS m
          WHERE m.entity = 'benefit'
            AND m.s1_id = r.benefit_nid
       ) AS benefit_present_in_id_map
  FROM election_benefit_refs AS r
 WHERE r.benefit_nid IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM s1_staging.records AS b
      WHERE b.bundle = 'sirius_trust_benefit'
        AND b.nid = r.benefit_nid
   )
 ORDER BY r.benefit_nid, r.election_nid;

\echo '4) Compact counts for the same derived set'
WITH election_benefit_refs AS (
  SELECT e.nid AS election_nid,
         CASE
           WHEN jsonb_typeof(v) IN ('number', 'string')
             AND (v #>> '{}') ~ '^[0-9]+$'
             THEN (v #>> '{}')::bigint
           WHEN (v->>'target_id') ~ '^[0-9]+$' THEN (v->>'target_id')::bigint
           WHEN (v->>'value') ~ '^[0-9]+$' THEN (v->>'value')::bigint
           WHEN (v->>'tid') ~ '^[0-9]+$' THEN (v->>'tid')::bigint
         END AS benefit_nid
    FROM s1_staging.records AS e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(e.fields->'field_sirius_trust_benefits')
        WHEN 'array' THEN e.fields->'field_sirius_trust_benefits'
        WHEN 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(e.fields->'field_sirius_trust_benefits')
      END
    ) AS values(v)
   WHERE e.bundle = 'sirius_trust_worker_election'
),
missing AS (
  SELECT r.*
    FROM election_benefit_refs AS r
   WHERE r.benefit_nid IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM s1_staging.records AS b
        WHERE b.bundle = 'sirius_trust_benefit'
          AND b.nid = r.benefit_nid
     )
)
SELECT count(*) AS missing_reference_values,
       count(DISTINCT election_nid) AS affected_elections,
       count(DISTINCT benefit_nid) AS missing_benefit_nids
  FROM missing;

ROLLBACK;
-- S1 rehearsal target: reconstruct T17 WMB provenance from staged S1 records
--
-- READ-ONLY OVERALL: all helper objects are pg_temp / TEMP and the transaction
-- ends with ROLLBACK.
--
-- Why this exists:
-- - t17_desired_spans is absent because T17 has never completed here.
-- - Current staged references resolve directly through worker/relation,
--   employer/election, and benefit mappings, matching T17.
-- - Existing entity='wb' id_map anchors are diagnostic-only; an unanchored
--   staged span is still authoritative when its direct references resolve.
-- - For each month key, T17 chooses source_relation_id from the LOWEST source
--   nid among covering spans. This query reproduces that rule.
--
-- Run as one SQL submission/session after ROLLBACK if the prior query failed.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.json_scalar(fields jsonb, field_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(fields -> field_key) = 'array'
      THEN fields -> field_key -> 0
    ELSE fields -> field_key
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.target_nid(fields jsonb, field_key text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  WITH scalar AS (
    SELECT pg_temp.json_scalar(fields, field_key) AS value
  ),
  candidate AS (
    SELECT CASE jsonb_typeof(value)
      WHEN 'number' THEN value #>> '{}'
      WHEN 'string' THEN value #>> '{}'
      WHEN 'object' THEN COALESCE(value ->> 'target_id', value ->> 'value')
      ELSE NULL
    END AS text_value
    FROM scalar
  )
  SELECT CASE
    WHEN text_value ~ '^[0-9]+$' THEN text_value::bigint
    ELSE NULL
  END
  FROM candidate
$$;

CREATE OR REPLACE FUNCTION pg_temp.field_text(fields jsonb, field_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH scalar AS (
    SELECT pg_temp.json_scalar(fields, field_key) AS value
  )
  SELECT NULLIF(btrim(CASE jsonb_typeof(value)
    WHEN 'object' THEN value ->> 'value'
    WHEN 'string' THEN value #>> '{}'
    WHEN 'number' THEN value #>> '{}'
    WHEN 'boolean' THEN value #>> '{}'
    ELSE NULL
  END), '')
  FROM scalar
$$;

CREATE OR REPLACE FUNCTION pg_temp.strict_ymd(raw_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text;
  parsed date;
BEGIN
  normalized := substring(btrim(raw_value) FROM '^([0-9]{4}-[0-9]{2}-[0-9]{2})');
  IF normalized IS NULL THEN
    RETURN NULL;
  END IF;
  parsed := to_date(normalized, 'YYYY-MM-DD');
  IF to_char(parsed, 'YYYY-MM-DD') <> normalized THEN
    RETURN NULL;
  END IF;
  RETURN parsed;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE TEMP TABLE wmb_collision_worker_plan (
  stale_worker_id varchar PRIMARY KEY,
  canonical_worker_id varchar NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO wmb_collision_worker_plan (
  stale_worker_id,
  canonical_worker_id
) VALUES
  ('0ce7767d-7dd7-4720-9190-97684872830c', '62703dd1-3a26-4ce4-9feb-a68a885014a6'),
  ('0e2571bd-5b3f-4b30-80a3-03f00e7e74f1', '93d9f467-ac01-4560-a594-d53c29ea219d'),
  ('20d9774a-2047-4b49-8194-9e9e84a159de', '05adec89-3e93-4d21-aa11-345481e381ca'),
  ('6506f9ec-79b8-4ea3-b9a5-80efdf3ef710', 'f8044871-27bf-45d6-83bc-4579284540c4'),
  ('69414db0-7aca-47bc-a166-017c3880ca19', '695a960c-8e8e-4b85-85ba-39e4dfcadc5c'),
  ('6f33dada-eeac-4eef-8214-bcbaa7a07b42', 'affab09c-bcf0-4e67-87ec-ba66ce9a7f50'),
  ('8ee36c3a-8f74-4563-9b41-0b647a3ce4af', '0be59a23-163e-4071-8486-d63eb1d4bbf2'),
  ('920744de-fc63-4e69-8221-6375111d9fb2', 'fa9249c0-1d2e-435c-b9a7-6e9c9dbe4284'),
  ('9c1f821d-dbe7-4e5f-9221-cdf086078acc', 'e542bd18-cf45-449b-b3fe-b6d0100675db'),
  ('b8f7044f-8abc-43f3-8f9c-3f30e41e2f89', '9b23185d-831f-43d7-81e9-3f0324f74680'),
  ('bb49c9b3-a2c1-4531-b16b-1e15c82cfb27', '67a0b5f8-21a4-4bd2-a09e-d60fc615af4f'),
  ('c2d128f1-c76e-49f7-b051-daf527983d8d', '4440b2a6-b640-4587-ad9c-d612a8b88d40');

CREATE TEMP TABLE collision_wmb
ON COMMIT DROP
AS
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  stale_wmb.id AS stale_wmb_id,
  canonical_wmb.id AS canonical_wmb_id,
  stale_wmb.employer_id,
  stale_wmb.benefit_id,
  stale_wmb.month,
  stale_wmb.year,
  stale_wmb.source_relation_id AS stale_source_relation_id,
  canonical_wmb.source_relation_id AS canonical_source_relation_id
FROM wmb_collision_worker_plan plan
JOIN trust_wmb stale_wmb
  ON stale_wmb.worker_id = plan.stale_worker_id
JOIN trust_wmb canonical_wmb
  ON canonical_wmb.worker_id = plan.canonical_worker_id
 AND canonical_wmb.month = stale_wmb.month
 AND canonical_wmb.year = stale_wmb.year
 AND canonical_wmb.employer_id = stale_wmb.employer_id
 AND canonical_wmb.benefit_id = stale_wmb.benefit_id;

CREATE TEMP TABLE staged_span_candidates
ON COMMIT DROP
AS
WITH staged_refs AS (
  SELECT
    staged.nid,
    staged.changed,
    staged.fields,
    pg_temp.target_nid(staged.fields, 'field_sirius_contact_relation')
      AS relation_nid,
    pg_temp.target_nid(staged.fields, 'field_sirius_trust_subscriber')
      AS subscriber_worker_nid,
    COALESCE(
      pg_temp.target_nid(staged.fields, 'field_sirius_trust_subscriber'),
      pg_temp.target_nid(staged.fields, 'field_sirius_worker')
    ) AS owner_worker_nid,
    pg_temp.target_nid(staged.fields, 'field_sirius_trust_benefit')
      AS benefit_nid,
    pg_temp.target_nid(staged.fields, 'field_grievance_shop')
      AS employer_nid,
    pg_temp.target_nid(staged.fields, 'field_sirius_trust_election')
      AS election_nid,
    pg_temp.strict_ymd(
      pg_temp.field_text(staged.fields, 'field_sirius_date_start')
    ) AS start_ymd,
    pg_temp.strict_ymd(
      pg_temp.field_text(staged.fields, 'field_sirius_date_end')
    ) AS explicit_end_ymd,
    lower(pg_temp.field_text(staged.fields, 'field_sirius_active'))
      AS active_text
  FROM s1_staging.records staged
  WHERE staged.bundle = 'sirius_trust_worker_benefit'
),
resolved AS (
  SELECT
    source.nid,
    source.relation_nid,
    relation_map.s2_id AS source_relation_id,
    COALESCE(relation.worker_2, owner_map.s2_id) AS resolved_worker_id,
    COALESCE(
      employer_map.s2_id,
      election.employer_id
    ) AS resolved_employer_id,
    COALESCE(
      benefit_map.s2_id,
      CASE WHEN benefit_by_sid.match_count = 1 THEN benefit_by_sid.benefit_id END,
      CASE WHEN benefit_by_name.match_count = 1 THEN benefit_by_name.benefit_id END
    ) AS resolved_benefit_id,
    source.start_ymd,
    CASE
      WHEN source.explicit_end_ymd IS NOT NULL THEN source.explicit_end_ymd
      WHEN source.active_text IN ('n', 'no', 'false', '0')
       AND source.changed BETWEEN 0 AND 4102444800
        THEN (to_timestamp(source.changed) AT TIME ZONE 'UTC')::date
      ELSE NULL
    END AS end_ymd,
    wb_map.s2_id AS anchor_wmb_id,
    anchor_wmb.worker_id AS anchor_worker_id,
    anchor_wmb.employer_id AS anchor_employer_id,
    anchor_wmb.benefit_id AS anchor_benefit_id,
    CASE
      WHEN source.start_ymd IS NULL
        THEN 'start date missing or invalid'
      WHEN source.relation_nid IS NOT NULL AND relation_map.s2_id IS NULL
        THEN 'relation mapping missing'
      WHEN source.relation_nid IS NOT NULL AND relation.id IS NULL
        THEN 'relation mapping dangling'
      WHEN source.subscriber_worker_nid IS NOT NULL
       AND subscriber_map.s2_id IS NOT NULL
       AND relation.id IS NOT NULL
       AND relation.worker_1 <> subscriber_map.s2_id
        THEN 'relation subscriber mismatch'
      WHEN source.relation_nid IS NULL AND owner_map.s2_id IS NULL
        THEN 'owner worker mapping missing'
      WHEN COALESCE(employer_map.s2_id, election.employer_id) IS NULL
        THEN 'employer unresolved'
      WHEN COALESCE(
        benefit_map.s2_id,
        CASE WHEN benefit_by_sid.match_count = 1 THEN benefit_by_sid.benefit_id END,
        CASE WHEN benefit_by_name.match_count = 1 THEN benefit_by_name.benefit_id END
      ) IS NULL
        THEN 'benefit unresolved'
      WHEN source.explicit_end_ymd IS NOT NULL
       AND source.explicit_end_ymd < source.start_ymd
        THEN 'end date precedes start date'
      ELSE NULL
    END AS resolution_issue
  FROM staged_refs source
  LEFT JOIN s1_staging.id_map wb_map
    ON wb_map.entity = 'wb'
   AND wb_map.s1_id = source.nid
   AND wb_map.stub = false
  LEFT JOIN trust_wmb anchor_wmb
    ON anchor_wmb.id = wb_map.s2_id
  LEFT JOIN s1_staging.id_map relation_map
    ON relation_map.entity = 'relation'
   AND relation_map.s1_id = source.relation_nid
   AND relation_map.stub = false
  LEFT JOIN worker_relations relation
    ON relation.id = relation_map.s2_id
  LEFT JOIN s1_staging.id_map subscriber_map
    ON subscriber_map.entity = 'worker'
   AND subscriber_map.s1_id = source.subscriber_worker_nid
   AND subscriber_map.stub = false
  LEFT JOIN s1_staging.id_map owner_map
    ON owner_map.entity = 'worker'
   AND owner_map.s1_id = source.owner_worker_nid
   AND owner_map.stub = false
  LEFT JOIN s1_staging.id_map employer_map
    ON employer_map.entity = 'employer'
   AND employer_map.s1_id = source.employer_nid
   AND employer_map.stub = false
  LEFT JOIN s1_staging.id_map election_map
    ON election_map.entity = 'election'
   AND election_map.s1_id = source.election_nid
   AND election_map.stub = false
  LEFT JOIN worker_trust_elections election
    ON election.id = election_map.s2_id
  LEFT JOIN s1_staging.id_map benefit_map
    ON benefit_map.entity = 'benefit'
   AND benefit_map.s1_id = source.benefit_nid
   AND benefit_map.stub = false
  LEFT JOIN s1_staging.records staged_benefit
    ON staged_benefit.bundle = 'sirius_trust_benefit'
   AND staged_benefit.nid = source.benefit_nid
  LEFT JOIN LATERAL (
    SELECT
      min(benefit.id) AS benefit_id,
      count(*)::bigint AS match_count
    FROM trust_benefits benefit
    WHERE benefit.sirius_id = source.benefit_nid::text
  ) benefit_by_sid ON true
  LEFT JOIN LATERAL (
    SELECT
      min(benefit.id) AS benefit_id,
      count(*)::bigint AS match_count
    FROM trust_benefits benefit
    WHERE lower(btrim(benefit.name)) =
          lower(btrim(staged_benefit.title))
  ) benefit_by_name ON true
)
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  source.nid,
  source.source_relation_id,
  source.start_ymd,
  source.end_ymd,
  source.anchor_wmb_id,
  source.resolved_employer_id AS employer_id,
  source.resolved_benefit_id AS benefit_id,
  CASE
    WHEN source.resolution_issue IS NOT NULL
      THEN source.resolution_issue
    WHEN source.resolved_worker_id NOT IN (
      plan.stale_worker_id,
      plan.canonical_worker_id
    )
      THEN 'wb anchor and staged source resolve to different workers'
    ELSE NULL
  END AS resolution_issue,
  CASE
    WHEN source.anchor_wmb_id IS NULL
      THEN 'unanchored'
    WHEN source.anchor_worker_id IS NULL
      THEN 'dangling anchor'
    WHEN source.anchor_worker_id NOT IN (
      plan.stale_worker_id,
      plan.canonical_worker_id
    )
      THEN 'anchor worker differs'
    WHEN source.anchor_employer_id IS DISTINCT FROM source.resolved_employer_id
      THEN 'anchor employer differs'
    WHEN source.anchor_benefit_id IS DISTINCT FROM source.resolved_benefit_id
      THEN 'anchor benefit differs'
    ELSE 'anchor agrees'
  END AS anchor_status,
  CASE
    WHEN source.resolved_worker_id = plan.stale_worker_id
      THEN plan.canonical_worker_id
    ELSE source.resolved_worker_id
  END AS normalized_worker_id
FROM resolved source
JOIN wmb_collision_worker_plan plan
  ON source.resolved_worker_id IN (
    plan.stale_worker_id,
    plan.canonical_worker_id
  )
  OR source.anchor_worker_id IN (
    plan.stale_worker_id,
    plan.canonical_worker_id
  );

CREATE TEMP TABLE staged_authority
ON COMMIT DROP
AS
SELECT
  collision.*,
  desired.covering_span_count,
  desired.desired_source_relation_id,
  CASE
    WHEN desired.covering_span_count = 0
      THEN 'STOP: no resolved staged S1 span covers this WMB key'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM collision.stale_source_relation_id
     AND desired.desired_source_relation_id
         IS NOT DISTINCT FROM collision.canonical_source_relation_id
      THEN 'READY: both rows already match staged S1 authority'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM collision.stale_source_relation_id
      THEN 'READY: adopt stale provenance on canonical WMB'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM collision.canonical_source_relation_id
      THEN 'READY: keep canonical provenance'
    ELSE 'READY: replace with third staged-source provenance'
  END AS decision
FROM collision_wmb collision
LEFT JOIN LATERAL (
  SELECT
    count(*)::bigint AS covering_span_count,
    (array_agg(span.source_relation_id ORDER BY span.nid))[1]
      AS desired_source_relation_id
  FROM staged_span_candidates span
  WHERE span.resolution_issue IS NULL
    AND span.normalized_worker_id = collision.canonical_worker_id
    AND span.employer_id = collision.employer_id
    AND span.benefit_id = collision.benefit_id
    AND (collision.year * 12 + collision.month - 1)
        BETWEEN (
          extract(year FROM span.start_ymd)::int * 12
          + extract(month FROM span.start_ymd)::int - 1
        )
        AND COALESCE(
          extract(year FROM span.end_ymd)::int * 12
          + extract(month FROM span.end_ymd)::int - 1,
          collision.year * 12 + collision.month - 1
        )
) desired ON true;

-- RESULT SET 1: STAGED-SOURCE AUTHORITY CLASSIFICATION
-- Expected total overlap rows: 727. Any STOP blocks execution.
SELECT
  stale_worker_id,
  canonical_worker_id,
  count(*)::bigint AS overlap_rows,
  count(*) FILTER (
    WHERE decision = 'READY: adopt stale provenance on canonical WMB'
  )::bigint AS adopt_stale_provenance,
  count(*) FILTER (
    WHERE decision = 'READY: keep canonical provenance'
  )::bigint AS keep_canonical_provenance,
  count(*) FILTER (
    WHERE decision = 'READY: both rows already match staged S1 authority'
  )::bigint AS both_match_authority,
  count(*) FILTER (
    WHERE decision = 'READY: replace with third staged-source provenance'
  )::bigint AS use_third_provenance,
  count(*) FILTER (WHERE decision LIKE 'STOP:%')::bigint AS blocked_rows,
  CASE
    WHEN count(*) FILTER (WHERE decision LIKE 'STOP:%') = 0
      THEN 'READY'
    ELSE 'STOP'
  END AS validation
FROM staged_authority
GROUP BY stale_worker_id, canonical_worker_id
ORDER BY stale_worker_id;

-- RESULT SET 2: STOP REASON COUNTS
-- Expected result: zero rows.
SELECT
  decision,
  count(*)::bigint AS affected_rows
FROM staged_authority
WHERE decision LIKE 'STOP:%'
GROUP BY decision
ORDER BY decision;

-- RESULT SET 3: SOURCE-SPAN RESOLUTION / T17 REJECT DIAGNOSTICS
-- Rows with a non-READY resolution_status are excluded from desired months,
-- exactly as T17 excludes rejected source records before expansion. They do
-- not block WMB authority, but the later T17 run must report/allow/remediate
-- the corresponding rejects.
SELECT
  stale_worker_id,
  canonical_worker_id,
  COALESCE(resolution_issue, 'READY') AS resolution_status,
  CASE resolution_issue
    WHEN 'benefit unresolved' THEN 'benefit_unmapped'
    WHEN 'relation mapping missing' THEN 'relation_unmapped'
    WHEN 'relation mapping dangling' THEN 'relation_map_broken'
    WHEN 'relation subscriber mismatch' THEN 'relation_subscriber_mismatch'
    WHEN 'owner worker mapping missing' THEN 'worker_unmapped'
    WHEN 'employer unresolved' THEN 'employer_unresolved'
    WHEN 'start date missing or invalid' THEN 'start_missing_or_bad_start_date'
    WHEN 'end date precedes start date' THEN 'end_before_start'
    WHEN 'wb anchor and staged source resolve to different workers'
      THEN 'preflight_only_anchor_worker_mismatch'
    ELSE NULL
  END AS expected_t17_reject,
  anchor_status,
  count(*)::bigint AS staged_span_count
FROM staged_span_candidates
GROUP BY stale_worker_id, canonical_worker_id, resolution_issue, anchor_status
ORDER BY stale_worker_id, resolution_status, anchor_status;

-- RESULT SET 4: THIRD-PROVENANCE SUMMARY
-- Opaque IDs only. These are valid T17 repair targets when result sets 1-3
-- contain no STOP/unresolved rows.
SELECT
  stale_worker_id,
  canonical_worker_id,
  desired_source_relation_id,
  count(*)::bigint AS affected_month_rows,
  min(year * 100 + month)::int AS first_yyyymm,
  max(year * 100 + month)::int AS last_yyyymm
FROM staged_authority
WHERE decision = 'READY: replace with third staged-source provenance'
GROUP BY stale_worker_id, canonical_worker_id, desired_source_relation_id
ORDER BY stale_worker_id, first_yyyymm, desired_source_relation_id;

ROLLBACK;
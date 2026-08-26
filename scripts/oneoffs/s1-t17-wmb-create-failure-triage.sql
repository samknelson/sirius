/*
  READ-ONLY T17 wmb_create_failed triage.

  Run this on the same rehearsal database immediately after the failed T17 run.
  The loader rebuilds s1_staging.t17_missing_rows on every run, so a later T17
  run replaces the evidence this query examines.

  Output:
    - one row per diagnosed cause
    - attempted row count and distinct S1 span count
    - up to 25 safe nid/month samples per cause

  No INSERT, UPDATE, DELETE, TRUNCATE, or DDL is performed.
*/
WITH staged_relation_refs AS (
  SELECT
    r.nid,
    CASE
      WHEN jsonb_typeof(r.fields -> 'field_sirius_contact_relation') = 'array'
        THEN r.fields -> 'field_sirius_contact_relation' -> 0
      ELSE r.fields -> 'field_sirius_contact_relation'
    END AS relation_scalar
  FROM s1_staging.records r
  WHERE r.bundle = 'sirius_trust_worker_benefit'
),
relation_refs AS (
  SELECT
    nid,
    CASE
      WHEN jsonb_typeof(relation_scalar) = 'object'
        THEN COALESCE(relation_scalar ->> 'target_id', relation_scalar ->> 'value')
      WHEN relation_scalar IS NULL
        THEN NULL
      ELSE trim(both '"' FROM relation_scalar::text)
    END AS relation_nid_text
  FROM staged_relation_refs
),
relation_nids AS (
  SELECT
    nid,
    CASE
      WHEN relation_nid_text ~ '^[0-9]+$' THEN relation_nid_text::bigint
      ELSE NULL
    END AS relation_nid
  FROM relation_refs
),
observed AS (
  SELECT
    m.nid,
    m.month,
    m.year,
    m.worker_id,
    m.employer_id,
    m.benefit_id,
    m.source_relation_id,
    rn.relation_nid,
    (w.id IS NOT NULL) AS worker_exists,
    (e.id IS NOT NULL) AS employer_exists,
    (b.id IS NOT NULL) AS benefit_exists,
    (m.source_relation_id IS NULL OR rel.id IS NOT NULL) AS source_relation_exists,
    (live.id IS NOT NULL) AS exact_wmb_exists,
    rel_map.s2_id AS current_mapped_relation_id
  FROM s1_staging.t17_missing_rows m
  LEFT JOIN workers w
    ON w.id = m.worker_id
  LEFT JOIN employers e
    ON e.id = m.employer_id
  LEFT JOIN trust_benefits b
    ON b.id = m.benefit_id
  LEFT JOIN worker_relations rel
    ON rel.id = m.source_relation_id
  LEFT JOIN relation_nids rn
    ON rn.nid = m.nid
  LEFT JOIN s1_staging.id_map rel_map
    ON rel_map.entity = 'relation'
   AND rel_map.s1_id = rn.relation_nid
   AND rel_map.stub = false
  LEFT JOIN trust_wmb live
    ON live.worker_id = m.worker_id
   AND live.employer_id = m.employer_id
   AND live.benefit_id = m.benefit_id
   AND live.month = m.month
   AND live.year = m.year
),
classified AS (
  SELECT
    observed.*,
    CASE
      WHEN NOT worker_exists THEN 'missing_worker'
      WHEN NOT employer_exists THEN 'missing_employer'
      WHEN NOT benefit_exists THEN 'missing_benefit'
      WHEN source_relation_id IS NOT NULL AND NOT source_relation_exists THEN
        CASE
          WHEN current_mapped_relation_id IS NULL
            THEN 'missing_source_relation_mapping_absent'
          WHEN current_mapped_relation_id <> source_relation_id
            THEN 'missing_source_relation_mapping_changed'
          ELSE 'missing_source_relation_mapping_points_to_missing_row'
        END
      WHEN exact_wmb_exists THEN 'exact_wmb_now_exists'
      ELSE 'unknown_insert_failure'
    END AS cause
  FROM observed
),
ranked AS (
  SELECT
    classified.*,
    row_number() OVER (
      PARTITION BY cause
      ORDER BY nid, year, month
    ) AS sample_rank
  FROM classified
)
SELECT
  cause,
  count(*)::bigint AS attempted_rows,
  count(DISTINCT nid)::bigint AS distinct_span_nids,
  jsonb_agg(
    jsonb_build_object(
      'nid', nid,
      'ym', format('%s-%s', year, lpad(month::text, 2, '0')),
      'relation_nid', relation_nid,
      'has_source_relation', source_relation_id IS NOT NULL,
      'current_mapping_matches_desired',
        CASE
          WHEN source_relation_id IS NULL OR current_mapped_relation_id IS NULL
            THEN NULL
          ELSE current_mapped_relation_id = source_relation_id
        END
    )
    ORDER BY nid, year, month
  ) FILTER (WHERE sample_rank <= 25) AS samples
FROM ranked
GROUP BY cause
ORDER BY attempted_rows DESC, cause;
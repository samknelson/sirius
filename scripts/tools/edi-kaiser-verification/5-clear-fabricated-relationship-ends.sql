-- One-time November 2026 Carelon cleanup for bao-stg, Neon SQL Editor.
-- First run ends in ROLLBACK: inspect/save the returned before/after rows.
-- To persist the reviewed cleanup, rerun with the FINAL ROLLBACK changed to COMMIT.
-- Only end_ymd changes. No source data, starts, metadata flags, fingerprints,
-- benefit records or eligibility decisions are changed.
-- Direct SQL does not invoke application audit/event hooks. Keep the returned
-- before/after rows as the repair receipt inside the authorized environment.
-- Fix the importer before running migration again; it can undo this repair.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE s1_staging.records, s1_staging.id_map IN SHARE MODE;
LOCK TABLE public.worker_relations IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE relationship_end_cleanup ON COMMIT DROP AS
WITH raw_source AS (
  SELECT m.s2_id AS relation_id, m.s1_id AS source_relationship_nid,
    f.key,
    CASE WHEN jsonb_typeof(f.value) = 'array' THEN f.value->0
         ELSE f.value END AS scalar
  FROM s1_staging.id_map m
  JOIN s1_staging.records s
    ON s.nid = m.s1_id AND s.bundle = 'sirius_contact_relationship'
  CROSS JOIN LATERAL (
    VALUES
      ('active', s.fields->'field_sirius_active'),
      ('start', s.fields->'field_sirius_date_start'),
      ('end', s.fields->'field_sirius_date_end')
  ) f(key, value)
  WHERE m.entity = 'relation' AND m.loader = 't15-relationships'
    AND m.s1_deleted_at IS NULL
    AND (SELECT count(*) FROM s1_staging.id_map other
         WHERE other.entity = 'relation' AND other.s2_id = m.s2_id) = 1
), normalized AS (
  SELECT relation_id, source_relationship_nid, key,
    nullif(btrim(
      CASE WHEN jsonb_typeof(scalar) = 'object' AND scalar ? 'value'
           THEN scalar->>'value' ELSE scalar #>> '{}' END
    ), '') AS value
  FROM raw_source
), source AS (
  SELECT relation_id, source_relationship_nid,
    max(value) FILTER (WHERE key = 'active') AS active,
    max(value) FILTER (WHERE key = 'start') AS source_start,
    max(value) FILTER (WHERE key = 'end') AS source_end
  FROM normalized GROUP BY relation_id, source_relationship_nid
)
SELECT r.id AS relation_id, s.source_relationship_nid,
  r.start_ymd AS retained_start, r.end_ymd AS previous_end,
  (SELECT count(*) FROM public.trust_wmb w
   JOIN public.trust_benefits b ON b.id = w.benefit_id
   WHERE w.source_relation_id = r.id AND w.worker_id = r.worker_2
     AND b.sirius_id = 'CARELONEAP' AND w.year = 2026 AND w.month = 11
  ) AS affected_coverage_records
FROM public.worker_relations r
JOIN source s ON s.relation_id = r.id
WHERE r.start_ymd = DATE '2000-01-01'
  AND r.end_ymd = DATE '2000-01-02'
  AND r.data->>'datesDefaulted' = 'true'
  AND lower(s.active) = 'yes'
  AND s.source_start IS NULL AND s.source_end IS NULL
  AND EXISTS (
    SELECT 1 FROM public.trust_wmb w
    JOIN public.trust_benefits b ON b.id = w.benefit_id
    WHERE w.source_relation_id = r.id AND w.worker_id = r.worker_2
      AND b.sirius_id = 'CARELONEAP' AND w.year = 2026 AND w.month = 11
  );

SELECT current_database() AS database_name,
  count(*) AS relationships_to_reopen,
  coalesce(sum(affected_coverage_records), 0) AS affected_coverage_records
FROM relationship_end_cleanup;

UPDATE public.worker_relations r
SET end_ymd = NULL
FROM relationship_end_cleanup c
WHERE r.id = c.relation_id
  AND r.start_ymd = c.retained_start
  AND r.end_ymd = c.previous_end
RETURNING r.id AS relationship_id, c.source_relationship_nid,
  c.previous_end, r.end_ymd AS new_end, r.start_ymd AS unchanged_start;

-- PREVIEW ONLY. Change this final statement to COMMIT after reviewing targets.
ROLLBACK;

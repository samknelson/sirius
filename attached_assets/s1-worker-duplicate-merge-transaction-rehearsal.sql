-- S1 rehearsal target: duplicate-worker merge TRANSACTION REHEARSAL
--
-- IMPORTANT:
-- - This script executes the full write path, verifies the resulting state,
--   and then ROLLS EVERYTHING BACK.
-- - It is safe to run as supplied; do not change the final ROLLBACK yet.
-- - Run the entire file as one SQL submission/session against the confirmed
--   migration-rehearsal-2026-08-06 target.
-- - Reads remain available. Writes to the touched tables may wait briefly.
--
-- Expected final result: one row with validation = READY_TO_COMMIT.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

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

CREATE TEMP TABLE worker_merge_plan (
  stale_worker_id varchar PRIMARY KEY,
  authoritative_s1_nid bigint NOT NULL UNIQUE,
  canonical_worker_id varchar NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO worker_merge_plan (
  stale_worker_id,
  authoritative_s1_nid,
  canonical_worker_id
) VALUES
  ('bff73bed-4d72-4d43-9587-601532c5a52a', 2901269, '1e03ee51-6f52-4ef7-bb9a-01311ed3a45a'),
  ('df866eda-7d9f-45eb-8234-6cb13b64590d', 3152551, '96f1f067-f985-4fa8-b373-0ea10c3a11ad'),
  ('b4a8cd5a-ad9d-4e3d-9314-81ef19092f37', 17065479, '8b7a0b30-c61d-40e4-b194-c1c7a34040fa'),
  ('c2d128f1-c76e-49f7-b051-daf527983d8d', 2618587, '4440b2a6-b640-4587-ad9c-d612a8b88d40'),
  ('0e2571bd-5b3f-4b30-80a3-03f00e7e74f1', 17065843, '93d9f467-ac01-4560-a594-d53c29ea219d'),
  ('02064fe0-a235-43d7-9ca8-6c366ee3e059', 3159428, '139f8de3-5a79-4950-baf6-9b864323fa17'),
  ('5ef77055-0d67-42f4-9a13-8ee5194f1500', 3035346, '95baf057-4960-4835-9641-e8bceff95372'),
  ('380b7e76-94df-4910-b4c7-6f88527c847f', 17065497, '4728e426-1d3f-4008-b550-277c58ab1be9'),
  ('9d20e0c6-7d40-40af-be60-5dbbb3385e3b', 16499181, 'ba9d2a43-a49c-44c8-875d-fb1d14932941'),
  ('b41cc597-7da9-498e-b37a-45c6ec2fe973', 16499183, 'a88013bc-ad6e-4c39-bf5b-1bed9893b090'),
  ('d5a7c8fd-9a23-44ca-a85c-4c967f7f28d3', 16499190, '551fec10-9dd8-4214-a89a-8589d01b4c23'),
  ('69414db0-7aca-47bc-a166-017c3880ca19', 17065749, '695a960c-8e8e-4b85-85ba-39e4dfcadc5c'),
  ('b8f7044f-8abc-43f3-8f9c-3f30e41e2f89', 17065751, '9b23185d-831f-43d7-81e9-3f0324f74680'),
  ('6f33dada-eeac-4eef-8214-bcbaa7a07b42', 17065753, 'affab09c-bcf0-4e67-87ec-ba66ce9a7f50'),
  ('920744de-fc63-4e69-8221-6375111d9fb2', 17065755, 'fa9249c0-1d2e-435c-b9a7-6e9c9dbe4284'),
  ('bb49c9b3-a2c1-4531-b16b-1e15c82cfb27', 17065416, '67a0b5f8-21a4-4bd2-a09e-d60fc615af4f'),
  ('0ce7767d-7dd7-4720-9190-97684872830c', 17065379, '62703dd1-3a26-4ce4-9feb-a68a885014a6'),
  ('6506f9ec-79b8-4ea3-b9a5-80efdf3ef710', 17065381, 'f8044871-27bf-45d6-83bc-4579284540c4'),
  ('9c1f821d-dbe7-4e5f-9221-cdf086078acc', 17065383, 'e542bd18-cf45-449b-b3fe-b6d0100675db'),
  ('8ee36c3a-8f74-4563-9b41-0b647a3ce4af', 17065800, '0be59a23-163e-4071-8486-d63eb1d4bbf2'),
  ('20d9774a-2047-4b49-8194-9e9e84a159de', 17065619, '05adec89-3e93-4d21-aa11-345481e381ca');

-- Keep reads available while fencing writes that could invalidate the plan.
LOCK TABLE workers IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE worker_relations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE trust_wmb IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE trust_wmb_events IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE s1_staging.id_map IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE s1_staging.records IN SHARE MODE;
LOCK TABLE ledger IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE locked_merge_plan
ON COMMIT DROP
AS
SELECT
  plan.*,
  stale.sirius_id::bigint AS stale_wrong_sid,
  canonical.sirius_id::bigint AS canonical_current_sid,
  NULLIF(staged.fields #>> '{field_sirius_id,value}', '')::bigint
    AS authoritative_current_s1_sid,
  mapped.s2_id AS authoritative_mapped_worker,
  (
    SELECT count(*)::bigint
    FROM s1_staging.id_map stale_map
    WHERE stale_map.entity = 'worker'
      AND stale_map.s2_id = plan.stale_worker_id
  ) AS stale_worker_map_count
FROM worker_merge_plan plan
LEFT JOIN workers stale
  ON stale.id = plan.stale_worker_id
LEFT JOIN workers canonical
  ON canonical.id = plan.canonical_worker_id
LEFT JOIN s1_staging.records staged
  ON staged.bundle = 'sirius_worker'
 AND staged.nid = plan.authoritative_s1_nid
LEFT JOIN s1_staging.id_map mapped
  ON mapped.entity = 'worker'
 AND mapped.s1_id = plan.authoritative_s1_nid;

CREATE TEMP TABLE stale_relations
ON COMMIT DROP
AS
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  relation.id AS relation_id,
  relation.worker_1,
  relation.relation_type,
  relation.start_ymd,
  relation.end_ymd,
  relation.data
FROM worker_merge_plan plan
JOIN worker_relations relation
  ON relation.worker_2 = plan.stale_worker_id;

CREATE TEMP TABLE wmb_overlaps
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
FROM worker_merge_plan plan
JOIN trust_wmb stale_wmb
  ON stale_wmb.worker_id = plan.stale_worker_id
JOIN trust_wmb canonical_wmb
  ON canonical_wmb.worker_id = plan.canonical_worker_id
 AND canonical_wmb.month = stale_wmb.month
 AND canonical_wmb.year = stale_wmb.year
 AND canonical_wmb.employer_id = stale_wmb.employer_id
 AND canonical_wmb.benefit_id = stale_wmb.benefit_id;

CREATE TEMP TABLE event_overlaps
ON COMMIT DROP
AS
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  stale_event.id AS stale_event_id,
  canonical_event.id AS canonical_event_id,
  stale_event.data AS stale_data,
  canonical_event.data AS canonical_data
FROM worker_merge_plan plan
JOIN trust_wmb_events stale_event
  ON stale_event.worker_id = plan.stale_worker_id
JOIN trust_wmb_events canonical_event
  ON canonical_event.worker_id = plan.canonical_worker_id
 AND canonical_event.year = stale_event.year
 AND canonical_event.month = stale_event.month
 AND canonical_event.benefit_id = stale_event.benefit_id
 AND canonical_event.event_type = stale_event.event_type;

CREATE TEMP TABLE source_missing_wmb_rows
ON COMMIT DROP
AS
SELECT id
FROM trust_wmb
WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9';

CREATE TEMP TABLE source_missing_relation_rows
ON COMMIT DROP
AS
SELECT id
FROM worker_relations
WHERE worker_1 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
   OR worker_2 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9';

-- Only the final worker pair needs month-level source reconstruction. The
-- other 11 overlapping pairs were fully resolved to stale provenance.
CREATE TEMP TABLE c2d_source_spans
ON COMMIT DROP
AS
WITH staged AS (
  SELECT
    source.nid,
    source.changed,
    source.fields,
    pg_temp.target_nid(source.fields, 'field_sirius_contact_relation')
      AS relation_nid,
    COALESCE(
      pg_temp.target_nid(source.fields, 'field_sirius_trust_subscriber'),
      pg_temp.target_nid(source.fields, 'field_sirius_worker')
    ) AS owner_worker_nid,
    pg_temp.strict_ymd(
      pg_temp.field_text(source.fields, 'field_sirius_date_start')
    ) AS start_ymd,
    pg_temp.strict_ymd(
      pg_temp.field_text(source.fields, 'field_sirius_date_end')
    ) AS explicit_end_ymd,
    lower(pg_temp.field_text(source.fields, 'field_sirius_active'))
      AS active_text
  FROM s1_staging.records source
  WHERE source.bundle = 'sirius_trust_worker_benefit'
),
resolved AS (
  SELECT
    source.nid,
    relation_map.s2_id AS source_relation_id,
    COALESCE(relation.worker_2, owner_map.s2_id) AS resolved_worker_id,
    anchor.employer_id,
    anchor.benefit_id,
    source.start_ymd,
    CASE
      WHEN source.explicit_end_ymd IS NOT NULL THEN source.explicit_end_ymd
      WHEN source.active_text IN ('n', 'no', 'false', '0')
       AND source.changed BETWEEN 0 AND 4102444800
        THEN (to_timestamp(source.changed) AT TIME ZONE 'UTC')::date
      ELSE NULL
    END AS end_ymd,
    source.relation_nid,
    relation.id AS resolved_relation_id,
    owner_map.s2_id AS resolved_owner_id
  FROM staged source
  JOIN s1_staging.id_map wb_map
    ON wb_map.entity = 'wb'
   AND wb_map.s1_id = source.nid
   AND wb_map.stub = false
  JOIN trust_wmb anchor
    ON anchor.id = wb_map.s2_id
   AND anchor.worker_id IN (
     'c2d128f1-c76e-49f7-b051-daf527983d8d',
     '4440b2a6-b640-4587-ad9c-d612a8b88d40'
   )
  LEFT JOIN s1_staging.id_map relation_map
    ON relation_map.entity = 'relation'
   AND relation_map.s1_id = source.relation_nid
   AND relation_map.stub = false
  LEFT JOIN worker_relations relation
    ON relation.id = relation_map.s2_id
  LEFT JOIN s1_staging.id_map owner_map
    ON owner_map.entity = 'worker'
   AND owner_map.s1_id = source.owner_worker_nid
   AND owner_map.stub = false
)
SELECT
  nid,
  source_relation_id,
  CASE
    WHEN resolved_worker_id = 'c2d128f1-c76e-49f7-b051-daf527983d8d'
      THEN '4440b2a6-b640-4587-ad9c-d612a8b88d40'
    ELSE resolved_worker_id
  END AS worker_id,
  employer_id,
  benefit_id,
  start_ymd,
  end_ymd
FROM resolved
WHERE start_ymd IS NOT NULL
  AND (
    (relation_nid IS NOT NULL AND resolved_relation_id IS NOT NULL)
    OR (relation_nid IS NULL AND resolved_owner_id IS NOT NULL)
  )
  AND (end_ymd IS NULL OR end_ymd >= start_ymd);

CREATE TEMP TABLE wmb_authority
ON COMMIT DROP
AS
SELECT
  overlap.*,
  CASE
    WHEN overlap.stale_worker_id <> 'c2d128f1-c76e-49f7-b051-daf527983d8d'
      THEN overlap.stale_source_relation_id
    ELSE c2d.desired_source_relation_id
  END AS desired_source_relation_id,
  CASE
    WHEN overlap.stale_worker_id <> 'c2d128f1-c76e-49f7-b051-daf527983d8d'
      THEN 1::bigint
    ELSE c2d.covering_span_count
  END AS covering_span_count
FROM wmb_overlaps overlap
LEFT JOIN LATERAL (
  SELECT
    count(*)::bigint AS covering_span_count,
    (array_agg(span.source_relation_id ORDER BY span.nid))[1]
      AS desired_source_relation_id
  FROM c2d_source_spans span
  WHERE span.worker_id = overlap.canonical_worker_id
    AND span.employer_id = overlap.employer_id
    AND span.benefit_id = overlap.benefit_id
    AND (overlap.year * 12 + overlap.month - 1)
        BETWEEN (
          extract(year FROM span.start_ymd)::int * 12
          + extract(month FROM span.start_ymd)::int - 1
        )
        AND COALESCE(
          extract(year FROM span.end_ymd)::int * 12
          + extract(month FROM span.end_ymd)::int - 1,
          overlap.year * 12 + overlap.month - 1
        )
) c2d
  ON overlap.stale_worker_id =
     'c2d128f1-c76e-49f7-b051-daf527983d8d';

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM locked_merge_plan) <> 21 THEN
    RAISE EXCEPTION 'merge plan drift: expected 21 rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM locked_merge_plan
    WHERE stale_wrong_sid IS NULL
       OR canonical_current_sid IS NULL
       OR authoritative_current_s1_sid IS NULL
       OR canonical_current_sid <> authoritative_current_s1_sid
       OR authoritative_mapped_worker IS DISTINCT FROM canonical_worker_id
       OR stale_worker_map_count <> 0
  ) THEN
    RAISE EXCEPTION 'worker authority validation failed';
  END IF;

  IF (SELECT count(*) FROM stale_relations) <> 21 THEN
    RAISE EXCEPTION 'relation drift: expected exactly 21 stale relations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stale_relations stale
    JOIN worker_relations canonical
      ON canonical.worker_1 = stale.worker_1
     AND canonical.worker_2 = stale.canonical_worker_id
     AND canonical.relation_type = stale.relation_type
     AND canonical.start_ymd IS NOT DISTINCT FROM stale.start_ymd
     AND canonical.end_ymd IS NOT DISTINCT FROM stale.end_ymd
     AND canonical.data IS NOT DISTINCT FROM stale.data
  ) THEN
    RAISE EXCEPTION 'relation drift: an equivalent canonical relation now exists';
  END IF;

  IF (
    SELECT count(*)
    FROM trust_wmb wmb
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id = wmb.worker_id
  ) <> 1271 THEN
    RAISE EXCEPTION 'WMB drift: expected 1271 stale rows';
  END IF;

  IF (SELECT count(*) FROM wmb_overlaps) <> 727 THEN
    RAISE EXCEPTION 'WMB drift: expected 727 overlap rows';
  END IF;

  IF (
    SELECT count(*)
    FROM trust_wmb_events event
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id = event.worker_id
  ) <> 283 THEN
    RAISE EXCEPTION 'WMB-event drift: expected 283 stale rows';
  END IF;

  IF (SELECT count(*) FROM event_overlaps) <> 61 THEN
    RAISE EXCEPTION 'WMB-event drift: expected 61 overlap rows';
  END IF;

  IF EXISTS (
    SELECT 1 FROM event_overlaps
    WHERE stale_data IS DISTINCT FROM canonical_data
  ) THEN
    RAISE EXCEPTION 'WMB-event drift: overlap payloads diverged';
  END IF;

  IF (SELECT count(*) FROM c2d_source_spans) <> 81 THEN
    RAISE EXCEPTION 'T17 authority drift: expected 81 resolved c2d spans';
  END IF;

  IF (SELECT count(*) FROM wmb_authority) <> 727
     OR EXISTS (
       SELECT 1 FROM wmb_authority WHERE covering_span_count = 0
     ) THEN
    RAISE EXCEPTION 'T17 authority drift: uncovered WMB overlap';
  END IF;

  IF (
    SELECT count(*) FROM wmb_authority
    WHERE desired_source_relation_id
          IS NOT DISTINCT FROM stale_source_relation_id
  ) <> 608 THEN
    RAISE EXCEPTION 'T17 authority drift: expected 608 stale-provenance overlaps';
  END IF;

  IF (
    SELECT count(*) FROM wmb_authority
    WHERE desired_source_relation_id
          IS NOT DISTINCT FROM canonical_source_relation_id
  ) <> 94 THEN
    RAISE EXCEPTION 'T17 authority drift: expected 94 canonical-provenance overlaps';
  END IF;

  IF (
    SELECT count(*) FROM wmb_authority
    WHERE desired_source_relation_id IS NULL
      AND desired_source_relation_id
          IS DISTINCT FROM stale_source_relation_id
      AND desired_source_relation_id
          IS DISTINCT FROM canonical_source_relation_id
      AND stale_worker_id = 'c2d128f1-c76e-49f7-b051-daf527983d8d'
      AND year * 100 + month BETWEEN 202403 AND 202409
  ) <> 25 THEN
    RAISE EXCEPTION 'T17 authority drift: expected 25 subscriber-provenance overlaps';
  END IF;

  IF (
    SELECT count(*) FROM trust_wmb
    WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  ) <> 85
  OR (
    SELECT count(*) FROM trust_wmb_events
    WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  ) <> 12
  OR (
    SELECT count(*) FROM worker_relations
    WHERE worker_2 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  ) <> 1
  OR NOT EXISTS (
    SELECT 1 FROM workers
    WHERE id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  ) THEN
    RAISE EXCEPTION 'source-missing worker cascade drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ledger entry
    WHERE (
      entry.reference_type = 'worker'
      AND entry.reference_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
    )
    OR (
      entry.reference_type = 'wmb'
      AND entry.reference_id IN (
        SELECT id FROM source_missing_wmb_rows
      )
    )
    OR (
      entry.reference_type = 'worker_relation'
      AND entry.reference_id IN (
        SELECT id FROM source_missing_relation_rows
      )
    )
  ) THEN
    RAISE EXCEPTION 'source-missing worker has ledger references; manual accounting review required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid IN (
        'trust_wmb'::regclass,
        'trust_wmb_events'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'new row-ID foreign key now references WMB/WMB events';
  END IF;
END
$preflight$;

DO $mutate$
DECLARE
  affected bigint;
BEGIN
  UPDATE worker_relations relation
     SET worker_2 = stale.canonical_worker_id
    FROM stale_relations stale
   WHERE relation.id = stale.relation_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 21 THEN
    RAISE EXCEPTION 'relation reparent count %, expected 21', affected;
  END IF;

  UPDATE trust_wmb canonical
     SET source_relation_id = authority.desired_source_relation_id
    FROM wmb_authority authority
   WHERE canonical.id = authority.canonical_wmb_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 727 THEN
    RAISE EXCEPTION 'canonical WMB provenance update count %, expected 727', affected;
  END IF;

  UPDATE s1_staging.id_map mapping
     SET s2_id = overlap.canonical_wmb_id
    FROM wmb_overlaps overlap
   WHERE mapping.entity = 'wb'
     AND mapping.s2_id = overlap.stale_wmb_id;

  UPDATE ledger entry
     SET reference_id = overlap.canonical_wmb_id
    FROM wmb_overlaps overlap
   WHERE entry.reference_type = 'wmb'
     AND entry.reference_id = overlap.stale_wmb_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'ledger drift: expected zero stale-overlap references, found %', affected;
  END IF;

  DELETE FROM trust_wmb stale
  USING wmb_overlaps overlap
  WHERE stale.id = overlap.stale_wmb_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 727 THEN
    RAISE EXCEPTION 'stale WMB overlap delete count %, expected 727', affected;
  END IF;

  UPDATE trust_wmb stale
     SET worker_id = plan.canonical_worker_id
    FROM worker_merge_plan plan
   WHERE stale.worker_id = plan.stale_worker_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 544 THEN
    RAISE EXCEPTION 'non-overlap WMB reparent count %, expected 544', affected;
  END IF;

  DELETE FROM trust_wmb_events stale
  USING event_overlaps overlap
  WHERE stale.id = overlap.stale_event_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 61 THEN
    RAISE EXCEPTION 'stale WMB-event overlap delete count %, expected 61', affected;
  END IF;

  UPDATE trust_wmb_events stale
     SET worker_id = plan.canonical_worker_id
    FROM worker_merge_plan plan
   WHERE stale.worker_id = plan.stale_worker_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 222 THEN
    RAISE EXCEPTION 'non-overlap WMB-event reparent count %, expected 222', affected;
  END IF;

  DELETE FROM workers stale
  USING worker_merge_plan plan
  WHERE stale.id = plan.stale_worker_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 21 THEN
    RAISE EXCEPTION 'stale worker delete count %, expected 21', affected;
  END IF;

  DELETE FROM s1_staging.id_map mapping
  WHERE (
    mapping.entity IN ('worker', 'shell-worker')
    AND mapping.s2_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  )
  OR (
    mapping.entity = 'wb'
    AND mapping.s2_id IN (
      SELECT id FROM source_missing_wmb_rows
    )
  )
  OR (
    mapping.entity = 'relation'
    AND mapping.s2_id IN (
      SELECT id FROM source_missing_relation_rows
    )
  );

  DELETE FROM workers
  WHERE id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'source-missing worker delete count %, expected 1', affected;
  END IF;
END
$mutate$;

DO $postcheck$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workers worker
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id = worker.id
  ) THEN
    RAISE EXCEPTION 'postcheck: stale worker survived';
  END IF;

  IF EXISTS (
    SELECT 1 FROM trust_wmb wmb
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id = wmb.worker_id
  )
  OR EXISTS (
    SELECT 1 FROM trust_wmb_events event
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id = event.worker_id
  )
  OR EXISTS (
    SELECT 1 FROM worker_relations relation
    JOIN worker_merge_plan plan
      ON plan.stale_worker_id IN (relation.worker_1, relation.worker_2)
  ) THEN
    RAISE EXCEPTION 'postcheck: stale worker dependency survived';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM wmb_authority authority
    LEFT JOIN trust_wmb canonical
      ON canonical.id = authority.canonical_wmb_id
    WHERE canonical.id IS NULL
       OR canonical.worker_id IS DISTINCT FROM authority.canonical_worker_id
       OR canonical.source_relation_id
          IS DISTINCT FROM authority.desired_source_relation_id
  ) THEN
    RAISE EXCEPTION 'postcheck: canonical WMB authority mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM s1_staging.id_map mapping
    JOIN wmb_overlaps overlap
      ON overlap.stale_wmb_id = mapping.s2_id
    WHERE mapping.entity = 'wb'
  ) THEN
    RAISE EXCEPTION 'postcheck: wb anchor still points at deleted stale WMB';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ledger entry
    JOIN wmb_overlaps overlap
      ON overlap.stale_wmb_id = entry.reference_id
    WHERE entry.reference_type = 'wmb'
  ) THEN
    RAISE EXCEPTION 'postcheck: ledger still points at deleted stale WMB';
  END IF;

  IF (
    SELECT count(*)
    FROM stale_relations stale
    JOIN worker_relations relation
      ON relation.id = stale.relation_id
     AND relation.worker_2 = stale.canonical_worker_id
  ) <> 21 THEN
    RAISE EXCEPTION 'postcheck: reparented relation count mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM locked_merge_plan plan
    LEFT JOIN s1_staging.id_map mapping
      ON mapping.entity = 'worker'
     AND mapping.s1_id = plan.authoritative_s1_nid
    LEFT JOIN workers canonical
      ON canonical.id = plan.canonical_worker_id
    WHERE mapping.s2_id IS DISTINCT FROM plan.canonical_worker_id
       OR canonical.sirius_id::bigint
          IS DISTINCT FROM plan.authoritative_current_s1_sid
  ) THEN
    RAISE EXCEPTION 'postcheck: canonical worker authority changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workers worker
    JOIN locked_merge_plan plan
      ON worker.sirius_id::bigint = plan.stale_wrong_sid
  ) THEN
    RAISE EXCEPTION 'postcheck: blocked stale SID remains owned';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM s1_staging.id_map mapping
    WHERE (
      mapping.entity IN ('worker', 'shell-worker')
      AND mapping.s2_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
    )
    OR (
      mapping.entity = 'wb'
      AND mapping.s2_id IN (
        SELECT id FROM source_missing_wmb_rows
      )
    )
    OR (
      mapping.entity = 'relation'
      AND mapping.s2_id IN (
        SELECT id FROM source_missing_relation_rows
      )
    )
  ) THEN
    RAISE EXCEPTION 'postcheck: source-missing migration anchor survived';
  END IF;

  IF EXISTS (
    SELECT 1 FROM workers
    WHERE id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  )
  OR EXISTS (
    SELECT 1 FROM trust_wmb
    WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  )
  OR EXISTS (
    SELECT 1 FROM trust_wmb_events
    WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  )
  OR EXISTS (
    SELECT 1 FROM worker_relations
    WHERE worker_1 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
       OR worker_2 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
  ) THEN
    RAISE EXCEPTION 'postcheck: source-missing worker or dependency survived';
  END IF;
END
$postcheck$;

SELECT
  'READY_TO_COMMIT'::text AS validation,
  21::bigint AS duplicate_workers_removed,
  1::bigint AS source_missing_workers_removed,
  21::bigint AS relations_reparented,
  727::bigint AS overlapping_wmb_rows_consolidated,
  544::bigint AS nonoverlap_wmb_rows_reparented,
  61::bigint AS duplicate_wmb_events_removed,
  222::bigint AS nonoverlap_wmb_events_reparented,
  25::bigint AS subscriber_provenance_rows_repaired,
  'ALL CHANGES ROLLED BACK'::text AS outcome;

ROLLBACK;
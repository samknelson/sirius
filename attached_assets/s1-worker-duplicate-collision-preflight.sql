-- S1 rehearsal target: duplicate worker collision preflight
--
-- READ-ONLY OVERALL: temporary plan inside a transaction, ending ROLLBACK.
-- Run this entire file as one SQL submission/session against the confirmed
-- migration-rehearsal-2026-08-06 target.
--
-- This classifies:
--   1. trust_wmb unique-key overlaps and relationship equivalence
--   2. trust_wmb_events unique-key overlaps and data equivalence
--   3. worker_relations consolidation/reparenting mode
--   4. any tables referencing trust_wmb/trust_wmb_events row IDs

BEGIN;

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

-- Lock-free repeat of the core authority checks. Any returned row is a STOP.
SELECT
  plan.stale_worker_id,
  plan.authoritative_s1_nid,
  plan.canonical_worker_id,
  stale.sirius_id AS stale_sid,
  canonical.sirius_id AS canonical_sid,
  NULLIF(staged.fields #>> '{field_sirius_id,value}', '')::bigint AS staged_sid,
  mapped.s2_id AS staged_mapped_worker
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
 AND mapped.s1_id = plan.authoritative_s1_nid
WHERE stale.id IS NULL
   OR canonical.id IS NULL
   OR NULLIF(staged.fields #>> '{field_sirius_id,value}', '')::bigint
        IS DISTINCT FROM canonical.sirius_id::bigint
   OR mapped.s2_id IS DISTINCT FROM plan.canonical_worker_id
   OR EXISTS (
        SELECT 1
        FROM s1_staging.id_map stale_map
        WHERE stale_map.entity = 'worker'
          AND stale_map.s2_id = plan.stale_worker_id
      );

-- RESULT SET 1: WMB COLLISION CLASSIFICATION
WITH wmb_key_matches AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    stale_wmb.id AS stale_wmb_id,
    canonical_wmb.id AS canonical_wmb_id,
    CASE
      WHEN stale_wmb.source_relation_id IS NULL
       AND canonical_wmb.source_relation_id IS NULL
        THEN true
      WHEN stale_wmb.source_relation_id = canonical_wmb.source_relation_id
        THEN true
      WHEN stale_relation.id IS NOT NULL
       AND canonical_relation.id IS NOT NULL
       AND stale_relation.worker_1 = canonical_relation.worker_1
       AND stale_relation.worker_2 = plan.stale_worker_id
       AND canonical_relation.worker_2 = plan.canonical_worker_id
       AND stale_relation.relation_type = canonical_relation.relation_type
       AND stale_relation.start_ymd IS NOT DISTINCT FROM canonical_relation.start_ymd
       AND stale_relation.end_ymd IS NOT DISTINCT FROM canonical_relation.end_ymd
       AND stale_relation.data IS NOT DISTINCT FROM canonical_relation.data
        THEN true
      ELSE false
    END AS relationship_payload_equivalent
  FROM worker_merge_plan plan
  JOIN trust_wmb stale_wmb
    ON stale_wmb.worker_id = plan.stale_worker_id
  JOIN trust_wmb canonical_wmb
    ON canonical_wmb.worker_id = plan.canonical_worker_id
   AND canonical_wmb.month = stale_wmb.month
   AND canonical_wmb.year = stale_wmb.year
   AND canonical_wmb.employer_id = stale_wmb.employer_id
   AND canonical_wmb.benefit_id = stale_wmb.benefit_id
  LEFT JOIN worker_relations stale_relation
    ON stale_relation.id = stale_wmb.source_relation_id
  LEFT JOIN worker_relations canonical_relation
    ON canonical_relation.id = canonical_wmb.source_relation_id
),
stale_counts AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    count(stale_wmb.id)::bigint AS stale_rows
  FROM worker_merge_plan plan
  LEFT JOIN trust_wmb stale_wmb
    ON stale_wmb.worker_id = plan.stale_worker_id
  GROUP BY plan.stale_worker_id, plan.canonical_worker_id
)
SELECT
  counts.stale_worker_id,
  counts.canonical_worker_id,
  counts.stale_rows,
  count(wmb_key_matches.stale_wmb_id)::bigint AS unique_key_overlaps,
  count(wmb_key_matches.stale_wmb_id) FILTER (
    WHERE wmb_key_matches.relationship_payload_equivalent
  )::bigint AS equivalent_overlaps,
  count(wmb_key_matches.stale_wmb_id) FILTER (
    WHERE NOT wmb_key_matches.relationship_payload_equivalent
  )::bigint AS divergent_overlaps,
  (
    counts.stale_rows - count(wmb_key_matches.stale_wmb_id)
  )::bigint AS nonoverlap_rows_to_reparent,
  CASE
    WHEN count(wmb_key_matches.stale_wmb_id) FILTER (
      WHERE NOT wmb_key_matches.relationship_payload_equivalent
    ) > 0
      THEN 'STOP: divergent WMB overlap'
    ELSE 'READY'
  END AS validation
FROM stale_counts counts
LEFT JOIN wmb_key_matches
  ON wmb_key_matches.stale_worker_id = counts.stale_worker_id
GROUP BY
  counts.stale_worker_id,
  counts.canonical_worker_id,
  counts.stale_rows
ORDER BY counts.stale_worker_id;

-- RESULT SET 2: WMB EVENT COLLISION CLASSIFICATION
WITH wmb_event_key_matches AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    stale_event.id AS stale_event_id,
    canonical_event.id AS canonical_event_id,
    stale_event.data IS NOT DISTINCT FROM canonical_event.data
      AS payload_equivalent
  FROM worker_merge_plan plan
  JOIN trust_wmb_events stale_event
    ON stale_event.worker_id = plan.stale_worker_id
  JOIN trust_wmb_events canonical_event
    ON canonical_event.worker_id = plan.canonical_worker_id
   AND canonical_event.year = stale_event.year
   AND canonical_event.month = stale_event.month
   AND canonical_event.benefit_id = stale_event.benefit_id
   AND canonical_event.event_type = stale_event.event_type
),
stale_counts AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    count(stale_event.id)::bigint AS stale_rows
  FROM worker_merge_plan plan
  LEFT JOIN trust_wmb_events stale_event
    ON stale_event.worker_id = plan.stale_worker_id
  GROUP BY plan.stale_worker_id, plan.canonical_worker_id
)
SELECT
  counts.stale_worker_id,
  counts.canonical_worker_id,
  counts.stale_rows,
  count(wmb_event_key_matches.stale_event_id)::bigint AS unique_key_overlaps,
  count(wmb_event_key_matches.stale_event_id) FILTER (
    WHERE wmb_event_key_matches.payload_equivalent
  )::bigint AS equivalent_overlaps,
  count(wmb_event_key_matches.stale_event_id) FILTER (
    WHERE NOT wmb_event_key_matches.payload_equivalent
  )::bigint AS divergent_overlaps,
  (
    counts.stale_rows - count(wmb_event_key_matches.stale_event_id)
  )::bigint AS nonoverlap_rows_to_reparent,
  CASE
    WHEN count(wmb_event_key_matches.stale_event_id) FILTER (
      WHERE NOT wmb_event_key_matches.payload_equivalent
    ) > 0
      THEN 'STOP: divergent WMB event overlap'
    ELSE 'READY'
  END AS validation
FROM stale_counts counts
LEFT JOIN wmb_event_key_matches
  ON wmb_event_key_matches.stale_worker_id = counts.stale_worker_id
GROUP BY
  counts.stale_worker_id,
  counts.canonical_worker_id,
  counts.stale_rows
ORDER BY counts.stale_worker_id;

-- RESULT SET 3: RELATION CONSOLIDATION CLASSIFICATION
-- Exactly one stale relation exists per reviewed worker.
-- 0 equivalent canonical rows: preserve relation ID and reparent worker_2.
-- 1 equivalent canonical row: repoint WMB source_relation_id and remove stale
-- relation.
-- >1 equivalent rows: stop; the canonical relation destination is ambiguous.
WITH relation_matches AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    stale_relation.id AS stale_relation_id,
    count(canonical_relation.id)::bigint AS equivalent_canonical_relations,
    min(canonical_relation.id) AS equivalent_canonical_relation_id,
    (
      SELECT count(*)::bigint
      FROM trust_wmb referenced_wmb
      WHERE referenced_wmb.source_relation_id = stale_relation.id
    ) AS total_wmb_references
  FROM worker_merge_plan plan
  JOIN worker_relations stale_relation
    ON stale_relation.worker_2 = plan.stale_worker_id
  LEFT JOIN worker_relations canonical_relation
    ON canonical_relation.worker_1 = stale_relation.worker_1
   AND canonical_relation.worker_2 = plan.canonical_worker_id
   AND canonical_relation.relation_type = stale_relation.relation_type
   AND canonical_relation.start_ymd IS NOT DISTINCT FROM stale_relation.start_ymd
   AND canonical_relation.end_ymd IS NOT DISTINCT FROM stale_relation.end_ymd
   AND canonical_relation.data IS NOT DISTINCT FROM stale_relation.data
  GROUP BY
    plan.stale_worker_id,
    plan.canonical_worker_id,
    stale_relation.id
)
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  matches.stale_relation_id,
  matches.equivalent_canonical_relations,
  matches.equivalent_canonical_relation_id,
  matches.total_wmb_references,
  CASE
    WHEN matches.stale_relation_id IS NULL
      THEN 'STOP: expected one stale relation but found none'
    WHEN (
      SELECT count(*)
      FROM worker_relations all_stale_relations
      WHERE all_stale_relations.worker_2 = plan.stale_worker_id
    ) <> 1
      THEN 'STOP: expected exactly one stale relation'
    WHEN matches.equivalent_canonical_relations = 0
      THEN 'READY: reparent stale relation'
    WHEN matches.equivalent_canonical_relations = 1
      THEN 'READY: consolidate equivalent relation'
    ELSE 'STOP: multiple equivalent canonical relations'
  END AS validation
FROM worker_merge_plan plan
LEFT JOIN relation_matches matches
  ON matches.stale_worker_id = plan.stale_worker_id
ORDER BY plan.stale_worker_id;

-- RESULT SET 4: ROW-ID REFERENCE CHECK
-- Expected result: zero rows. Any returned row is a STOP before deleting exact
-- duplicate WMB/WMB-event rows.
SELECT
  con.confrelid::regclass::text AS referenced_table,
  con.conrelid::regclass::text AS referencing_table,
  con.conname AS foreign_key_name,
  pg_get_constraintdef(con.oid) AS foreign_key_definition
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.confrelid IN (
    'trust_wmb'::regclass,
    'trust_wmb_events'::regclass
  )
ORDER BY referenced_table, referencing_table, foreign_key_name;

ROLLBACK;
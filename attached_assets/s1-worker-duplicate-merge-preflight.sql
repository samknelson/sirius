-- S1 rehearsal target: stale worker duplicate merge preflight
--
-- READ-ONLY OVERALL: this script uses temporary tables inside a transaction
-- and ends with ROLLBACK.
--
-- Run this entire file as one SQL submission/session against the confirmed
-- migration-rehearsal-2026-08-06 target.
--
-- Result sets:
--   1. PLAN VALIDATION — every row must be READY
--   2. DEPENDENCY INVENTORY — every direct FK reference on the 21 stale rows
--   3. UNIQUE INDEX REVIEW — constraints that can collide during reparenting
--   4. ONE SOURCE-MISSING DELETE CHECK — must remain exactly the approved row

BEGIN;

CREATE TEMP TABLE approved_worker_duplicate_map (
  stale_worker_id varchar PRIMARY KEY,
  authoritative_s1_nid bigint NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO approved_worker_duplicate_map (
  stale_worker_id,
  authoritative_s1_nid
) VALUES
  ('bff73bed-4d72-4d43-9587-601532c5a52a', 2901269),
  ('df866eda-7d9f-45eb-8234-6cb13b64590d', 3152551),
  ('b4a8cd5a-ad9d-4e3d-9314-81ef19092f37', 17065479),
  ('c2d128f1-c76e-49f7-b051-daf527983d8d', 2618587),
  ('0e2571bd-5b3f-4b30-80a3-03f00e7e74f1', 17065843),
  ('02064fe0-a235-43d7-9ca8-6c366ee3e059', 3159428),
  ('5ef77055-0d67-42f4-9a13-8ee5194f1500', 3035346),
  ('380b7e76-94df-4910-b4c7-6f88527c847f', 17065497),
  ('9d20e0c6-7d40-40af-be60-5dbbb3385e3b', 16499181),
  ('b41cc597-7da9-498e-b37a-45c6ec2fe973', 16499183),
  ('d5a7c8fd-9a23-44ca-a85c-4c967f7f28d3', 16499190),
  ('69414db0-7aca-47bc-a166-017c3880ca19', 17065749),
  ('b8f7044f-8abc-43f3-8f9c-3f30e41e2f89', 17065751),
  ('6f33dada-eeac-4eef-8214-bcbaa7a07b42', 17065753),
  ('920744de-fc63-4e69-8221-6375111d9fb2', 17065755),
  ('bb49c9b3-a2c1-4531-b16b-1e15c82cfb27', 17065416),
  ('0ce7767d-7dd7-4720-9190-97684872830c', 17065379),
  ('6506f9ec-79b8-4ea3-b9a5-80efdf3ef710', 17065381),
  ('9c1f821d-dbe7-4e5f-9221-cdf086078acc', 17065383),
  ('8ee36c3a-8f74-4563-9b41-0b647a3ce4af', 17065800),
  ('20d9774a-2047-4b49-8194-9e9e84a159de', 17065619);

CREATE TEMP TABLE resolved_worker_duplicate_map
ON COMMIT DROP
AS
WITH source_authority AS (
  SELECT
    r.nid AS authoritative_s1_nid,
    NULLIF(r.fields #>> '{field_sirius_id,value}', '')::bigint
      AS authoritative_current_s1_sid
  FROM s1_staging.records r
  WHERE r.bundle = 'sirius_worker'
),
stale_map_counts AS (
  SELECT
    m.s2_id AS stale_worker_id,
    count(*)::integer AS stale_id_map_count
  FROM s1_staging.id_map m
  WHERE m.entity = 'worker'
  GROUP BY m.s2_id
)
SELECT
  approved.stale_worker_id,
  stale.sirius_id::bigint AS stale_wrong_sid,
  approved.authoritative_s1_nid,
  source.authoritative_current_s1_sid,
  canonical_map.s2_id AS canonical_worker_id,
  canonical.sirius_id::bigint AS canonical_current_sid,
  COALESCE(stale_maps.stale_id_map_count, 0) AS stale_id_map_count,
  count(*) OVER (
    PARTITION BY canonical_map.s2_id
  )::integer AS stale_rows_per_canonical_worker
FROM approved_worker_duplicate_map approved
LEFT JOIN workers stale
  ON stale.id = approved.stale_worker_id
LEFT JOIN source_authority source
  ON source.authoritative_s1_nid = approved.authoritative_s1_nid
LEFT JOIN s1_staging.id_map canonical_map
  ON canonical_map.entity = 'worker'
 AND canonical_map.s1_id = approved.authoritative_s1_nid
LEFT JOIN workers canonical
  ON canonical.id = canonical_map.s2_id
LEFT JOIN stale_map_counts stale_maps
  ON stale_maps.stale_worker_id = approved.stale_worker_id;

-- RESULT SET 1: PLAN VALIDATION
-- Every row must say READY. The expected row count is exactly 21.
SELECT
  plan.*,
  CASE
    WHEN stale_wrong_sid IS NULL
      THEN 'ERROR: stale S2 worker does not exist'
    WHEN authoritative_current_s1_sid IS NULL
      THEN 'ERROR: authoritative S1 worker is not staged or has no numeric SID'
    WHEN canonical_worker_id IS NULL
      THEN 'ERROR: authoritative S1 NID has no canonical S2 id_map'
    WHEN canonical_current_sid IS NULL
      THEN 'ERROR: canonical S2 worker does not exist'
    WHEN stale_worker_id = canonical_worker_id
      THEN 'ERROR: stale and canonical workers are the same row'
    WHEN authoritative_current_s1_sid <> canonical_current_sid
      THEN 'ERROR: canonical S2 SID differs from current staged S1 authority'
    WHEN stale_id_map_count <> 0
      THEN 'ERROR: stale duplicate unexpectedly owns one or more worker id_map rows'
    WHEN stale_rows_per_canonical_worker <> 1
      THEN 'ERROR: multiple stale rows resolve to the same canonical worker'
    ELSE 'READY'
  END AS validation
FROM resolved_worker_duplicate_map plan
ORDER BY stale_wrong_sid;

CREATE TEMP TABLE worker_duplicate_dependency_inventory (
  child_table text NOT NULL,
  child_column text NOT NULL,
  on_delete_action text NOT NULL,
  stale_worker_id varchar NOT NULL,
  canonical_worker_id varchar,
  dependent_rows bigint NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT
      con.conrelid::regclass::text AS child_table,
      attr.attname AS child_column,
      CASE con.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END AS on_delete_action
    FROM pg_constraint con
    JOIN pg_attribute attr
      ON attr.attrelid = con.conrelid
     AND attr.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'workers'::regclass
      AND cardinality(con.conkey) = 1
  LOOP
    EXECUTE format(
      'INSERT INTO worker_duplicate_dependency_inventory (
         child_table,
         child_column,
         on_delete_action,
         stale_worker_id,
         canonical_worker_id,
         dependent_rows
       )
       SELECT
         %L,
         %L,
         %L,
         plan.stale_worker_id,
         plan.canonical_worker_id,
         count(*)::bigint
       FROM %s child
       JOIN resolved_worker_duplicate_map plan
         ON child.%I::text = plan.stale_worker_id
       GROUP BY plan.stale_worker_id, plan.canonical_worker_id',
      relation.child_table,
      relation.child_column,
      relation.on_delete_action,
      relation.child_table::regclass,
      relation.child_column
    );
  END LOOP;
END $$;

-- RESULT SET 2: DEPENDENCY INVENTORY
-- This is safe to share: it contains opaque IDs and aggregate counts only.
SELECT
  child_table,
  child_column,
  on_delete_action,
  stale_worker_id,
  canonical_worker_id,
  dependent_rows
FROM worker_duplicate_dependency_inventory
WHERE dependent_rows > 0
ORDER BY
  child_table,
  child_column,
  stale_worker_id;

-- RESULT SET 3: UNIQUE INDEX REVIEW
-- Any listed index may reject a stale→canonical update if both workers already
-- have rows with the same remaining key. The execution script must handle each
-- actual collision explicitly; it must not disable these constraints.
SELECT DISTINCT
  inventory.child_table,
  inventory.child_column,
  idx.indexrelid::regclass::text AS unique_index,
  pg_get_indexdef(idx.indexrelid) AS index_definition,
  pg_get_expr(idx.indpred, idx.indrelid) AS partial_predicate
FROM worker_duplicate_dependency_inventory inventory
JOIN pg_class child_class
  ON child_class.oid = inventory.child_table::regclass
JOIN pg_attribute worker_attr
  ON worker_attr.attrelid = child_class.oid
 AND worker_attr.attname = inventory.child_column
JOIN pg_index idx
  ON idx.indrelid = child_class.oid
 AND idx.indisunique
 AND worker_attr.attnum = ANY(idx.indkey::smallint[])
WHERE inventory.dependent_rows > 0
ORDER BY inventory.child_table, inventory.child_column, unique_index;

-- RESULT SET 4: SOURCE-MISSING DELETE CHECK
-- This does not delete anything. The counts should still be exactly:
--   trust_wmb=85, trust_wmb_events=12, worker_relations.worker_2=1
SELECT
  child_table,
  child_column,
  on_delete_action,
  dependent_rows
FROM (
  SELECT
    'trust_wmb'::text AS child_table,
    'worker_id'::text AS child_column,
    'CASCADE'::text AS on_delete_action,
    count(*)::bigint AS dependent_rows
  FROM trust_wmb
  WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'

  UNION ALL

  SELECT
    'trust_wmb_events',
    'worker_id',
    'CASCADE',
    count(*)::bigint
  FROM trust_wmb_events
  WHERE worker_id = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'

  UNION ALL

  SELECT
    'worker_relations',
    'worker_2',
    'CASCADE',
    count(*)::bigint
  FROM worker_relations
  WHERE worker_2 = '95a40120-41bf-4f65-9a5c-4b2d3e79faf9'
) approved_delete_check
ORDER BY child_table, child_column;

ROLLBACK;
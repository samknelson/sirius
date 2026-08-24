-- S1 rehearsal target: stale/canonical SSN ownership inventory
--
-- READ-ONLY OVERALL. This script creates only a temporary inventory table and
-- ends with ROLLBACK; it does not persist changes or expose the SSN value.
-- Run against the confirmed production-profile rehearsal S2 target.
--
-- Every status in RESULT SET 1 must be READY before using the rehearsal or
-- commit scripts. RESULT SETS 2-4 document mappings and references only.

BEGIN;

-- RESULT SET 1: STRICT IDENTITY AND SSN PLAN VALIDATION
WITH params AS (
  SELECT
    '0eefcabf-1e8d-4980-a209-5d90cfccd981'::varchar AS stale_worker_id,
    '9d7fe027-ebc5-45fc-ae12-88d30b069179'::varchar AS canonical_worker_id
),
plan AS (
  SELECT
    stale.id IS NOT NULL AS stale_exists,
    stale.id AS stale_worker_id,
    stale.sirius_id::text AS stale_sirius_id,
    stale.ssn IS NOT NULL AND btrim(stale.ssn) <> '' AS stale_has_ssn,
    canonical.id IS NOT NULL AS canonical_exists,
    canonical.id AS canonical_worker_id,
    canonical.sirius_id::text AS canonical_sirius_id,
    canonical.ssn IS NULL OR btrim(canonical.ssn) = '' AS canonical_ssn_empty,
    (
      SELECT count(*)::integer
      FROM workers owner
      WHERE owner.ssn IS NOT DISTINCT FROM stale.ssn
        AND stale.ssn IS NOT NULL
        AND btrim(stale.ssn) <> ''
    ) AS current_ssn_owner_count,
    (
      SELECT count(*)::integer
      FROM s1_staging.records r
      WHERE r.bundle = 'sirius_worker'
        AND r.nid = 15933572
        AND NULLIF(r.fields #>> '{field_sirius_id,value}', '')::text = '1001214'
    ) AS surviving_source_count,
    (
      SELECT count(*)::integer
      FROM s1_staging.records r
      WHERE r.bundle = 'sirius_worker'
        AND r.nid = 3166519
    ) AS retired_source_count,
    (
      SELECT count(*)::integer
      FROM s1_staging.id_map m
      WHERE m.entity = 'worker'
        AND m.s1_id = 15933572
        AND m.s2_id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
    ) AS surviving_map_count
  FROM params p
  LEFT JOIN workers stale
    ON stale.id = p.stale_worker_id
  LEFT JOIN workers canonical
    ON canonical.id = p.canonical_worker_id
)
SELECT
  plan.*,
  CASE
    WHEN NOT stale_exists
      THEN 'ERROR: stale worker does not exist'
    WHEN NOT canonical_exists
      THEN 'ERROR: canonical worker does not exist'
    WHEN stale_sirius_id <> '753404'
      THEN 'ERROR: stale worker Sirius ID changed'
    WHEN canonical_sirius_id <> '1001214'
      THEN 'ERROR: canonical worker Sirius ID changed'
    WHEN NOT stale_has_ssn
      THEN 'ERROR: stale worker no longer owns an SSN'
    WHEN NOT canonical_ssn_empty
      THEN 'ERROR: canonical worker already owns an SSN'
    WHEN current_ssn_owner_count <> 1
      THEN 'ERROR: stale SSN is not uniquely owned'
    WHEN surviving_source_count <> 1
      THEN 'ERROR: surviving S1 identity is absent or ambiguous'
    WHEN retired_source_count <> 0
      THEN 'ERROR: retired S1 identity unexpectedly exists in current staging'
    WHEN surviving_map_count <> 1
      THEN 'ERROR: surviving S1 NID is not mapped to the canonical worker'
    ELSE 'READY'
  END AS status
FROM plan;

-- RESULT SET 2: WORKER ID-MAP DISPOSITION
-- This SSN-only repair does not modify either mapping.
SELECT
  m.entity,
  m.s1_id,
  m.s2_id,
  m.stub,
  CASE
    WHEN m.s1_id = 15933572
      AND m.s2_id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
      THEN 'KEEP: surviving authoritative mapping'
    WHEN m.s1_id = 3166519
      THEN 'REVIEW: retired NID mapping; unchanged by SSN-only repair'
    WHEN m.s2_id = '0eefcabf-1e8d-4980-a209-5d90cfccd981'
      THEN 'REVIEW: stale worker mapping; unchanged by SSN-only repair'
    ELSE 'RELATED'
  END AS disposition
FROM s1_staging.id_map m
WHERE m.entity = 'worker'
  AND (
    m.s1_id IN (15933572, 3166519)
    OR m.s2_id IN (
      '9d7fe027-ebc5-45fc-ae12-88d30b069179',
      '0eefcabf-1e8d-4980-a209-5d90cfccd981'
    )
  )
ORDER BY m.s1_id, m.s2_id;

-- RESULT SET 3: DIRECT FK REFERENCE COUNTS
-- References are inventoried but not changed by the SSN-only repair.
CREATE TEMP TABLE ssn_transfer_fk_inventory (
  child_table text NOT NULL,
  child_column text NOT NULL,
  on_delete_action text NOT NULL,
  canonical_rows bigint NOT NULL,
  stale_rows bigint NOT NULL
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
      'INSERT INTO ssn_transfer_fk_inventory (
         child_table,
         child_column,
         on_delete_action,
         canonical_rows,
         stale_rows
       )
       SELECT %L, %L, %L,
         count(*) FILTER (
           WHERE child.%I::text = %L
         )::bigint,
         count(*) FILTER (
           WHERE child.%I::text = %L
         )::bigint
       FROM %s child',
      relation.child_table,
      relation.child_column,
      relation.on_delete_action,
      relation.child_column,
      '9d7fe027-ebc5-45fc-ae12-88d30b069179',
      relation.child_column,
      '0eefcabf-1e8d-4980-a209-5d90cfccd981',
      relation.child_table::regclass
    );
  END LOOP;
END $$;

SELECT *
FROM ssn_transfer_fk_inventory
WHERE canonical_rows > 0 OR stale_rows > 0
ORDER BY child_table, child_column;

-- RESULT SET 4: KNOWN SOFT-REFERENCE SEARCH
-- Text/JSON occurrences only; values are not rewritten by this package.
SELECT
  's1_staging.id_map'::text AS source,
  count(*) FILTER (
    WHERE m.s2_id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
  )::bigint AS canonical_rows,
  count(*) FILTER (
    WHERE m.s2_id = '0eefcabf-1e8d-4980-a209-5d90cfccd981'
  )::bigint AS stale_rows
FROM s1_staging.id_map m
WHERE m.entity = 'worker';

ROLLBACK;
-- S1 rehearsal target: post-commit SSN ownership verification
--
-- READ ONLY. Emits booleans/counts only; never emits the SSN value.
-- Expected final status: PASS.

BEGIN TRANSACTION READ ONLY;

WITH canonical AS (
  SELECT id, sirius_id::text AS sirius_id, ssn
  FROM workers
  WHERE id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
),
stale AS (
  SELECT id, sirius_id::text AS sirius_id, ssn
  FROM workers
  WHERE id = '0eefcabf-1e8d-4980-a209-5d90cfccd981'
),
checks AS (
  SELECT
    (SELECT count(*) FROM canonical)::integer AS canonical_row_count,
    (SELECT count(*) FROM stale)::integer AS stale_row_count,
    COALESCE(
      (SELECT sirius_id = '1001214' FROM canonical),
      false
    ) AS canonical_sid_preserved,
    COALESCE(
      (SELECT sirius_id = '753404' FROM stale),
      false
    ) AS stale_sid_preserved,
    COALESCE(
      (SELECT ssn IS NOT NULL AND btrim(ssn) <> '' FROM canonical),
      false
    ) AS canonical_has_ssn,
    COALESCE(
      (SELECT ssn IS NULL OR btrim(ssn) = '' FROM stale),
      false
    ) AS stale_ssn_released,
    (
      SELECT count(*)::integer
      FROM workers owner
      JOIN canonical c
        ON owner.ssn IS NOT DISTINCT FROM c.ssn
      WHERE c.ssn IS NOT NULL
        AND btrim(c.ssn) <> ''
    ) AS canonical_ssn_owner_count,
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
)
SELECT
  checks.*,
  CASE
    WHEN canonical_row_count <> 1 THEN 'FAIL: canonical worker missing'
    WHEN stale_row_count <> 1 THEN 'FAIL: stale worker missing'
    WHEN NOT canonical_sid_preserved THEN 'FAIL: canonical Sirius ID changed'
    WHEN NOT stale_sid_preserved THEN 'FAIL: stale Sirius ID changed'
    WHEN NOT canonical_has_ssn THEN 'FAIL: canonical worker has no SSN'
    WHEN NOT stale_ssn_released THEN 'FAIL: stale worker still has an SSN'
    WHEN canonical_ssn_owner_count <> 1
      THEN 'FAIL: canonical SSN is not uniquely owned'
    WHEN surviving_source_count <> 1
      THEN 'FAIL: surviving S1 identity is absent or ambiguous'
    WHEN retired_source_count <> 0
      THEN 'FAIL: retired S1 identity exists in current staging'
    WHEN surviving_map_count <> 1
      THEN 'FAIL: surviving S1 NID mapping changed'
    ELSE 'PASS'
  END AS status
FROM checks;

ROLLBACK;
-- S1 rehearsal target: guarded SSN ownership transfer rehearsal
--
-- Performs the complete SSN transfer inside one transaction, proves the
-- intended post-state, emits no SSN value, and always ROLLS BACK.
--
-- Expected final result: READY_TO_COMMIT.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TEMP TABLE ssn_transfer_snapshot (
  stale_worker_id varchar PRIMARY KEY,
  canonical_worker_id varchar NOT NULL UNIQUE,
  captured_ssn text NOT NULL
) ON COMMIT DROP;

INSERT INTO ssn_transfer_snapshot (
  stale_worker_id,
  canonical_worker_id,
  captured_ssn
)
SELECT
  stale.id,
  canonical.id,
  stale.ssn
FROM workers stale
CROSS JOIN workers canonical
WHERE stale.id = '0eefcabf-1e8d-4980-a209-5d90cfccd981'
  AND canonical.id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
FOR UPDATE OF stale, canonical;

DO $$
DECLARE
  stale_sid text;
  canonical_sid text;
  canonical_ssn text;
  captured_ssn text;
  owner_count integer;
  surviving_source_count integer;
  retired_source_count integer;
  surviving_map_count integer;
BEGIN
  IF (SELECT count(*) FROM ssn_transfer_snapshot) <> 1 THEN
    RAISE EXCEPTION
      'SSN transfer refused: expected exactly one locked stale/canonical pair';
  END IF;

  SELECT w.sirius_id::text
  INTO stale_sid
  FROM workers w
  WHERE w.id = '0eefcabf-1e8d-4980-a209-5d90cfccd981';

  SELECT w.sirius_id::text, w.ssn
  INTO canonical_sid, canonical_ssn
  FROM workers w
  WHERE w.id = '9d7fe027-ebc5-45fc-ae12-88d30b069179';

  SELECT s.captured_ssn
  INTO captured_ssn
  FROM ssn_transfer_snapshot s;

  SELECT count(*)::integer
  INTO owner_count
  FROM workers w
  WHERE w.ssn IS NOT DISTINCT FROM captured_ssn;

  SELECT count(*)::integer
  INTO surviving_source_count
  FROM s1_staging.records r
  WHERE r.bundle = 'sirius_worker'
    AND r.nid = 15933572
    AND NULLIF(r.fields #>> '{field_sirius_id,value}', '')::text = '1001214';

  SELECT count(*)::integer
  INTO retired_source_count
  FROM s1_staging.records r
  WHERE r.bundle = 'sirius_worker'
    AND r.nid = 3166519;

  SELECT count(*)::integer
  INTO surviving_map_count
  FROM s1_staging.id_map m
  WHERE m.entity = 'worker'
    AND m.s1_id = 15933572
    AND m.s2_id = '9d7fe027-ebc5-45fc-ae12-88d30b069179';

  IF stale_sid IS DISTINCT FROM '753404' THEN
    RAISE EXCEPTION 'SSN transfer refused: stale Sirius ID changed';
  END IF;
  IF canonical_sid IS DISTINCT FROM '1001214' THEN
    RAISE EXCEPTION 'SSN transfer refused: canonical Sirius ID changed';
  END IF;
  IF captured_ssn IS NULL OR btrim(captured_ssn) = '' THEN
    RAISE EXCEPTION 'SSN transfer refused: stale worker has no SSN';
  END IF;
  IF canonical_ssn IS NOT NULL AND btrim(canonical_ssn) <> '' THEN
    RAISE EXCEPTION 'SSN transfer refused: canonical worker already has an SSN';
  END IF;
  IF owner_count <> 1 THEN
    RAISE EXCEPTION
      'SSN transfer refused: captured SSN has % current owners, expected 1',
      owner_count;
  END IF;
  IF surviving_source_count <> 1 THEN
    RAISE EXCEPTION
      'SSN transfer refused: surviving S1 source count is %, expected 1',
      surviving_source_count;
  END IF;
  IF retired_source_count <> 0 THEN
    RAISE EXCEPTION
      'SSN transfer refused: retired S1 source count is %, expected 0',
      retired_source_count;
  END IF;
  IF surviving_map_count <> 1 THEN
    RAISE EXCEPTION
      'SSN transfer refused: surviving worker map count is %, expected 1',
      surviving_map_count;
  END IF;
END $$;

-- Release the unique SSN first, then assign the exact captured value.
UPDATE workers
SET ssn = NULL
WHERE id = '0eefcabf-1e8d-4980-a209-5d90cfccd981';

UPDATE workers canonical
SET ssn = snapshot.captured_ssn
FROM ssn_transfer_snapshot snapshot
WHERE canonical.id = snapshot.canonical_worker_id;

DO $$
DECLARE
  captured_ssn text;
  canonical_owner_count integer;
  stale_owner_count integer;
  all_owner_count integer;
BEGIN
  SELECT s.captured_ssn
  INTO captured_ssn
  FROM ssn_transfer_snapshot s;

  SELECT count(*)::integer
  INTO canonical_owner_count
  FROM workers w
  WHERE w.id = '9d7fe027-ebc5-45fc-ae12-88d30b069179'
    AND w.sirius_id::text = '1001214'
    AND w.ssn IS NOT DISTINCT FROM captured_ssn;

  SELECT count(*)::integer
  INTO stale_owner_count
  FROM workers w
  WHERE w.id = '0eefcabf-1e8d-4980-a209-5d90cfccd981'
    AND w.sirius_id::text = '753404'
    AND (w.ssn IS NULL OR btrim(w.ssn) = '');

  SELECT count(*)::integer
  INTO all_owner_count
  FROM workers w
  WHERE w.ssn IS NOT DISTINCT FROM captured_ssn;

  IF canonical_owner_count <> 1
     OR stale_owner_count <> 1
     OR all_owner_count <> 1 THEN
    RAISE EXCEPTION
      'SSN transfer postcheck failed: canonical=%, stale_empty=%, owners=%',
      canonical_owner_count,
      stale_owner_count,
      all_owner_count;
  END IF;
END $$;

SELECT
  'READY_TO_COMMIT'::text AS result,
  1::integer AS canonical_workers_with_transferred_ssn,
  1::integer AS stale_workers_with_released_ssn,
  0::integer AS sirius_ids_changed,
  0::integer AS workers_deleted,
  0::integer AS references_reparented;

ROLLBACK;
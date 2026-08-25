-- Remove stale S1 election references to deleted benefit nid 2457521.
--
-- MUTATING, GUARDED, IDEMPOTENT. Run once against the Drupal 7 MariaDB source.
--
-- Proven before this script was written:
--   - node 2457521 no longer exists;
--   - the original bad set was exactly 54 live field rows on 54 elections;
--   - every sampled remaining row is delta=1 and its election has six other
--     valid sirius_trust_benefit references.
--
-- This script re-proves those conditions for the rows that remain after any
-- manual fixes. It deletes the current field_data row and the matching row for
-- the election's CURRENT revision. Older historical revisions are preserved.
-- Surviving deltas are intentionally not renumbered: their relative order is
-- unchanged, and this avoids rewriting valid benefit references.
--
-- Terminal result:
--   COMMITTED                    = exact guarded cleanup applied
--   NOOP_ALREADY_CLEAN           = no matching current references remained
--   BLOCKED_NO_CHANGES           = a safety guard failed; nothing was deleted
--   ROLLED_BACK_POSTCHECK_FAILED = delete/post counts differed; all rolled back

SET @target_benefit_nid := 2457521;
SET @original_max_rows := 54;

START TRANSACTION;

-- Lock the target-id range before taking the working snapshot. With InnoDB's
-- normal REPEATABLE READ isolation, this also prevents a matching row from
-- appearing midway through the cleanup.
SELECT count(*) AS locked_current_reference_rows
  FROM field_data_field_sirius_trust_benefits
 WHERE entity_type = 'node'
   AND bundle = 'sirius_trust_worker_election'
   AND deleted = 0
   AND field_sirius_trust_benefits_target_id = @target_benefit_nid
 FOR UPDATE;

DROP TEMPORARY TABLE IF EXISTS tmp_t16_stale_benefit_refs;
CREATE TEMPORARY TABLE tmp_t16_stale_benefit_refs (
  entity_id int(10) unsigned NOT NULL,
  revision_id int(10) unsigned NOT NULL,
  delta int(10) unsigned NOT NULL,
  PRIMARY KEY (entity_id, revision_id, delta)
) ENGINE=MEMORY;

INSERT INTO tmp_t16_stale_benefit_refs (entity_id, revision_id, delta)
SELECT entity_id, revision_id, delta
  FROM field_data_field_sirius_trust_benefits
 WHERE entity_type = 'node'
   AND bundle = 'sirius_trust_worker_election'
   AND deleted = 0
   AND field_sirius_trust_benefits_target_id = @target_benefit_nid;

SELECT count(*) INTO @stale_rows
  FROM tmp_t16_stale_benefit_refs;

SELECT count(DISTINCT entity_id) INTO @affected_elections
  FROM tmp_t16_stale_benefit_refs;

SELECT count(*) INTO @unexpected_delta_rows
  FROM tmp_t16_stale_benefit_refs
 WHERE delta <> 1;

SELECT count(*) INTO @target_benefit_nodes
  FROM node
 WHERE nid = @target_benefit_nid;

SELECT count(*) INTO @bad_election_nodes
  FROM tmp_t16_stale_benefit_refs AS stale
  LEFT JOIN node AS election
    ON election.nid = stale.entity_id
 WHERE election.nid IS NULL
    OR election.type <> 'sirius_trust_worker_election';

SELECT count(*) INTO @elections_without_other_valid_benefit
  FROM (
    SELECT stale.entity_id
      FROM tmp_t16_stale_benefit_refs AS stale
      LEFT JOIN field_data_field_sirius_trust_benefits AS other_ref
        ON other_ref.entity_type = 'node'
       AND other_ref.bundle = 'sirius_trust_worker_election'
       AND other_ref.deleted = 0
       AND other_ref.entity_id = stale.entity_id
       AND other_ref.field_sirius_trust_benefits_target_id <> @target_benefit_nid
      LEFT JOIN node AS other_benefit
        ON other_benefit.nid = other_ref.field_sirius_trust_benefits_target_id
       AND other_benefit.type = 'sirius_trust_benefit'
     GROUP BY stale.entity_id
    HAVING sum(other_benefit.nid IS NOT NULL) = 0
  ) AS unsafe;

-- The current field_data row's revision_id must identify one exact matching
-- field_revision row. A mismatch blocks the whole cleanup.
SELECT count(*) INTO @matching_current_revision_rows
  FROM field_revision_field_sirius_trust_benefits AS revision_ref
  JOIN tmp_t16_stale_benefit_refs AS stale
    ON stale.entity_id = revision_ref.entity_id
   AND stale.revision_id = revision_ref.revision_id
   AND stale.delta = revision_ref.delta
 WHERE revision_ref.entity_type = 'node'
   AND revision_ref.bundle = 'sirius_trust_worker_election'
   AND revision_ref.deleted = 0
   AND revision_ref.field_sirius_trust_benefits_target_id = @target_benefit_nid;

SET @guard_ok := (
  @stale_rows = 0
  OR (
    @stale_rows BETWEEN 1 AND @original_max_rows
    AND @affected_elections = @stale_rows
    AND @unexpected_delta_rows = 0
    AND @target_benefit_nodes = 0
    AND @bad_election_nodes = 0
    AND @elections_without_other_valid_benefit = 0
    AND @matching_current_revision_rows = @stale_rows
  )
);

SELECT
  @stale_rows AS remaining_stale_rows,
  @affected_elections AS affected_elections,
  @unexpected_delta_rows AS unexpected_delta_rows,
  @target_benefit_nodes AS target_benefit_nodes,
  @bad_election_nodes AS bad_election_nodes,
  @elections_without_other_valid_benefit AS elections_without_other_valid_benefit,
  @matching_current_revision_rows AS matching_current_revision_rows,
  @guard_ok AS guard_ok;

-- Delete the matching current-revision copy first, then the authoritative
-- current field_data row. Both deletes are disabled when any guard failed.
DELETE revision_ref
  FROM field_revision_field_sirius_trust_benefits AS revision_ref
  JOIN tmp_t16_stale_benefit_refs AS stale
    ON stale.entity_id = revision_ref.entity_id
   AND stale.revision_id = revision_ref.revision_id
   AND stale.delta = revision_ref.delta
 WHERE @guard_ok = 1
   AND revision_ref.entity_type = 'node'
   AND revision_ref.bundle = 'sirius_trust_worker_election'
   AND revision_ref.deleted = 0
   AND revision_ref.field_sirius_trust_benefits_target_id = @target_benefit_nid;
SET @deleted_revision_rows := row_count();

DELETE current_ref
  FROM field_data_field_sirius_trust_benefits AS current_ref
  JOIN tmp_t16_stale_benefit_refs AS stale
    ON stale.entity_id = current_ref.entity_id
   AND stale.revision_id = current_ref.revision_id
   AND stale.delta = current_ref.delta
 WHERE @guard_ok = 1
   AND current_ref.entity_type = 'node'
   AND current_ref.bundle = 'sirius_trust_worker_election'
   AND current_ref.deleted = 0
   AND current_ref.field_sirius_trust_benefits_target_id = @target_benefit_nid;
SET @deleted_current_rows := row_count();

SELECT count(*) INTO @remaining_current_rows
  FROM field_data_field_sirius_trust_benefits
 WHERE entity_type = 'node'
   AND bundle = 'sirius_trust_worker_election'
   AND deleted = 0
   AND field_sirius_trust_benefits_target_id = @target_benefit_nid;

SELECT count(*) INTO @remaining_exact_revision_rows
  FROM field_revision_field_sirius_trust_benefits AS revision_ref
  JOIN tmp_t16_stale_benefit_refs AS stale
    ON stale.entity_id = revision_ref.entity_id
   AND stale.revision_id = revision_ref.revision_id
   AND stale.delta = revision_ref.delta
 WHERE revision_ref.entity_type = 'node'
   AND revision_ref.bundle = 'sirius_trust_worker_election'
   AND revision_ref.deleted = 0
   AND revision_ref.field_sirius_trust_benefits_target_id = @target_benefit_nid;

SET @postcheck_ok := (
  @guard_ok = 0
  OR (
    @deleted_revision_rows = @stale_rows
    AND @deleted_current_rows = @stale_rows
    AND @remaining_current_rows = 0
    AND @remaining_exact_revision_rows = 0
  )
);

-- MariaDB supports transaction control in prepared statements. This makes the
-- script itself choose COMMIT vs ROLLBACK from the verified postconditions.
SET @finish_sql := IF(@postcheck_ok = 1, 'COMMIT', 'ROLLBACK');
PREPARE finish_statement FROM @finish_sql;
EXECUTE finish_statement;
DEALLOCATE PREPARE finish_statement;

SELECT
  CASE
    WHEN @stale_rows = 0 THEN 'NOOP_ALREADY_CLEAN'
    WHEN @guard_ok = 0 THEN 'BLOCKED_NO_CHANGES'
    WHEN @postcheck_ok = 0 THEN 'ROLLED_BACK_POSTCHECK_FAILED'
    ELSE 'COMMITTED'
  END AS result,
  @stale_rows AS expected_rows,
  @deleted_current_rows AS deleted_current_rows,
  @deleted_revision_rows AS deleted_current_revision_rows,
  @remaining_current_rows AS remaining_current_rows,
  @remaining_exact_revision_rows AS remaining_exact_current_revision_rows;

DROP TEMPORARY TABLE IF EXISTS tmp_t16_stale_benefit_refs;
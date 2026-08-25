-- T16 benefit_unmapped cleanup preflight — S1 source
--
-- READ ONLY. Run against the Drupal 7 MariaDB source.
--
-- The first investigation proved that benefit node 2457521 is gone while 54
-- live election field rows still reference it at delta=1. Before any cleanup,
-- this verifies:
--   1. all 54 affected election nodes still exist;
--   2. every active benefit reference on those elections;
--   3. whether each other referenced benefit node exists with the expected
--      sirius_trust_benefit bundle.

START TRANSACTION READ ONLY;

SELECT 'affected-election-summary' AS check_name;
SELECT count(*) AS affected_reference_rows,
       count(DISTINCT stale.entity_id) AS affected_elections,
       sum(CASE WHEN election.nid IS NULL THEN 1 ELSE 0 END) AS missing_election_nodes,
       sum(CASE WHEN election.type = 'sirius_trust_worker_election' THEN 1 ELSE 0 END) AS correctly_typed_election_nodes
  FROM field_data_field_sirius_trust_benefits AS stale
  LEFT JOIN node AS election
    ON election.nid = stale.entity_id
 WHERE stale.entity_type = 'node'
   AND stale.bundle = 'sirius_trust_worker_election'
   AND stale.deleted = 0
   AND stale.field_sirius_trust_benefits_target_id = 2457521;

SELECT 'referenced-benefit-summary' AS check_name;
SELECT refs.field_sirius_trust_benefits_target_id AS benefit_nid,
       count(*) AS reference_rows,
       count(DISTINCT refs.entity_id) AS affected_elections,
       benefit.nid IS NOT NULL AS benefit_node_exists,
       benefit.type AS benefit_node_type,
       benefit.status AS benefit_node_status
  FROM field_data_field_sirius_trust_benefits AS refs
  JOIN (
    SELECT DISTINCT entity_id
      FROM field_data_field_sirius_trust_benefits
     WHERE entity_type = 'node'
       AND bundle = 'sirius_trust_worker_election'
       AND deleted = 0
       AND field_sirius_trust_benefits_target_id = 2457521
  ) AS affected
    ON affected.entity_id = refs.entity_id
  LEFT JOIN node AS benefit
    ON benefit.nid = refs.field_sirius_trust_benefits_target_id
 WHERE refs.entity_type = 'node'
   AND refs.bundle = 'sirius_trust_worker_election'
   AND refs.deleted = 0
 GROUP BY refs.field_sirius_trust_benefits_target_id,
          benefit.nid,
          benefit.type,
          benefit.status
 ORDER BY benefit_nid;

SELECT 'per-election-benefit-context' AS check_name;
SELECT refs.entity_id AS election_nid,
       count(*) AS active_benefit_refs,
       sum(refs.field_sirius_trust_benefits_target_id = 2457521) AS stale_ref_count,
       sum(
         refs.field_sirius_trust_benefits_target_id <> 2457521
         AND benefit.nid IS NOT NULL
         AND benefit.type = 'sirius_trust_benefit'
       ) AS other_valid_benefit_refs,
       group_concat(
         concat(
           refs.delta,
           ':',
           refs.field_sirius_trust_benefits_target_id,
           ':',
           coalesce(benefit.type, 'MISSING')
         )
         ORDER BY refs.delta
         SEPARATOR ','
       ) AS benefit_refs_by_delta
  FROM field_data_field_sirius_trust_benefits AS refs
  JOIN (
    SELECT DISTINCT entity_id
      FROM field_data_field_sirius_trust_benefits
     WHERE entity_type = 'node'
       AND bundle = 'sirius_trust_worker_election'
       AND deleted = 0
       AND field_sirius_trust_benefits_target_id = 2457521
  ) AS affected
    ON affected.entity_id = refs.entity_id
  LEFT JOIN node AS benefit
    ON benefit.nid = refs.field_sirius_trust_benefits_target_id
 WHERE refs.entity_type = 'node'
   AND refs.bundle = 'sirius_trust_worker_election'
   AND refs.deleted = 0
 GROUP BY refs.entity_id
 ORDER BY refs.entity_id;

SELECT 'cleanup-safety-summary' AS check_name;
SELECT count(*) AS affected_elections,
       sum(context.other_valid_benefit_refs > 0) AS elections_with_another_valid_benefit,
       sum(context.other_valid_benefit_refs = 0) AS elections_without_another_valid_benefit,
       min(context.active_benefit_refs) AS min_active_refs_before_cleanup,
       max(context.active_benefit_refs) AS max_active_refs_before_cleanup
  FROM (
    SELECT refs.entity_id,
           count(*) AS active_benefit_refs,
           sum(
             refs.field_sirius_trust_benefits_target_id <> 2457521
             AND benefit.nid IS NOT NULL
             AND benefit.type = 'sirius_trust_benefit'
           ) AS other_valid_benefit_refs
      FROM field_data_field_sirius_trust_benefits AS refs
      JOIN (
        SELECT DISTINCT entity_id
          FROM field_data_field_sirius_trust_benefits
         WHERE entity_type = 'node'
           AND bundle = 'sirius_trust_worker_election'
           AND deleted = 0
           AND field_sirius_trust_benefits_target_id = 2457521
      ) AS affected
        ON affected.entity_id = refs.entity_id
      LEFT JOIN node AS benefit
        ON benefit.nid = refs.field_sirius_trust_benefits_target_id
     WHERE refs.entity_type = 'node'
       AND refs.bundle = 'sirius_trust_worker_election'
       AND refs.deleted = 0
     GROUP BY refs.entity_id
  ) AS context;

COMMIT;
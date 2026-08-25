-- T16 benefit_unmapped investigation — S1 source
--
-- READ ONLY. Run this against the Drupal 7 MariaDB source database.
-- The target-side script identifies the complete missing benefit_nid set.
-- Replace the IN-list below with every benefit_nid returned by target query 3
-- if it contains more than 2457521.
--
-- This script deliberately checks both the benefit node and the election field
-- rows. A deleted benefit node can leave Drupal field references behind; that
-- is a source cleanup problem, not stale S2 staging.

START TRANSACTION READ ONLY;

SELECT 'field-table-column-check' AS check_name;
SHOW COLUMNS
  FROM field_data_field_sirius_trust_benefits
 WHERE Field IN (
   'entity_id',
   'entity_type',
   'bundle',
   'deleted',
   'delta',
   'field_sirius_trust_benefits_target_id'
 );

SELECT 'benefit-node-presence' AS check_name;
SELECT nid,
       type,
       status,
       changed
  FROM node
 WHERE nid IN (2457521);

SELECT 'election-reference-rows' AS check_name;
SELECT entity_id AS election_nid,
       entity_type,
       bundle,
       deleted,
       delta,
       field_sirius_trust_benefits_target_id AS benefit_nid
  FROM field_data_field_sirius_trust_benefits
 WHERE entity_type = 'node'
   AND bundle = 'sirius_trust_worker_election'
   AND deleted = 0
   AND field_sirius_trust_benefits_target_id IN (2457521)
 ORDER BY entity_id, delta;

SELECT 'reference-summary' AS check_name;
SELECT count(*) AS reference_rows,
       count(DISTINCT entity_id) AS affected_elections,
       count(DISTINCT field_sirius_trust_benefits_target_id) AS referenced_benefits
  FROM field_data_field_sirius_trust_benefits
 WHERE entity_type = 'node'
   AND bundle = 'sirius_trust_worker_election'
   AND deleted = 0
   AND field_sirius_trust_benefits_target_id IN (2457521);

COMMIT;
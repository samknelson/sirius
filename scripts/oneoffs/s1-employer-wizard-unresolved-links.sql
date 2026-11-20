-- Q17: Diagnose Q16's missing-parent / non-unique-live-employer cohorts.
-- S1 MariaDB 10.6. Run the WHOLE file in Beekeeper on ONE connection.
-- READ ONLY: no names, raw notes/JSON, files, row contents, or amounts.
-- Output: numeric source IDs and structural evidence; inspect before sharing.
-- This is NOT a repair, fallback mapping, or authorization to import.
-- On error, stop and ROLLBACK before running anything else.
-- At the Q16 snapshot: 4,316 candidates, 153 diagnostic feeds (139 + 14).
-- A newer snapshot may differ. Window totals precede the 200-row output cap;
-- if diagnostic_feed_count > 200, output is INCOMPLETE. Do not infer absence.

START TRANSACTION READ ONLY;

WITH
types AS (
  SELECT f.entity_id, COUNT(*) AS field_rows,
         MIN(f.field_sirius_type_value) AS source_type
  FROM field_data_field_sirius_type AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
),
candidates AS (
  SELECT n.nid, t.source_type
  FROM node AS n JOIN types AS t ON t.entity_id = n.nid
  WHERE n.type = 'sirius_feed' AND t.field_rows = 1
    AND t.source_type IN ('sirius_smf_feed_ehrs', 'sirius_smf_feed_ehrs_correction')
),
parents AS (
  SELECT n.nid
  FROM node AS n
  WHERE n.type = 'sirius_log'
    AND EXISTS (
      SELECT 1 FROM field_data_field_sirius_category AS cat
      WHERE cat.entity_type = 'node' AND cat.bundle = 'sirius_log'
        AND cat.deleted = 0 AND cat.entity_id = n.nid
        AND cat.field_sirius_category_value = 'smf:ehrs'
    )
),
links AS (
  SELECT c.nid, COUNT(DISTINCT p.nid) AS parent_count, MIN(p.nid) AS parent_nid
  FROM candidates AS c
  JOIN field_data_field_sirius_log_handler AS h
    ON h.field_sirius_log_handler_target_id = c.nid
   AND h.entity_type = 'node' AND h.bundle = 'sirius_log' AND h.deleted = 0
  JOIN parents AS p ON p.nid = h.entity_id
  GROUP BY c.nid
),
parent_employers AS (
  SELECT p.nid, COUNT(*) AS live_employer_handler_rows,
         COUNT(DISTINCT e.nid) AS distinct_live_employers
  FROM parents AS p
  JOIN field_data_field_sirius_log_handler AS h
    ON h.entity_id = p.nid AND h.entity_type = 'node'
   AND h.bundle = 'sirius_log' AND h.deleted = 0
  JOIN node AS e ON e.nid = h.field_sirius_log_handler_target_id
    AND e.type = 'grievance_shop'
  GROUP BY p.nid
),
unresolved AS (
  SELECT c.*, COALESCE(l.parent_count, 0) AS parent_count,
         CASE WHEN l.parent_count = 1 THEN l.parent_nid END AS parent_nid,
         COALESCE(pe.live_employer_handler_rows, 0) AS live_employer_handler_rows,
         COALESCE(pe.distinct_live_employers, 0) AS distinct_live_employers
  FROM candidates AS c
  LEFT JOIN links AS l ON l.nid = c.nid
  LEFT JOIN parent_employers AS pe ON pe.nid = l.parent_nid
  WHERE COALESCE(l.parent_count, 0) = 0
     OR (l.parent_count = 1 AND COALESCE(pe.live_employer_handler_rows, 0) <> 1)
),
keys_raw AS (
  SELECT u.nid, COUNT(f.entity_id) AS key_rows,
         MIN(f.field_sirius_notes_value) AS period_key
  FROM unresolved AS u
  LEFT JOIN field_data_field_sirius_notes AS f
    ON f.entity_id = u.parent_nid AND f.entity_type = 'node'
   AND f.bundle = 'sirius_log' AND f.deleted = 0
  GROUP BY u.nid
),
keys_parsed AS (
  SELECT k.nid, k.key_rows,
         CASE WHEN k.key_rows = 1 AND
           k.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$'
           THEN CAST(SUBSTRING_INDEX(k.period_key, '/', 1) AS UNSIGNED) END AS key_employer_nid,
         CASE WHEN k.key_rows = 1 AND
           k.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$'
           THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(k.period_key, '/', 2), '/', -1)
                     AS UNSIGNED) END AS reporting_year,
         CASE WHEN k.key_rows = 1 AND
           k.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$'
           THEN CAST(SUBSTRING_INDEX(k.period_key, '/', -1) AS UNSIGNED) END AS reporting_month
  FROM keys_raw AS k
),
feed_employers AS (
  SELECT u.nid, COUNT(f.entity_id) AS field_rows,
         CASE WHEN COUNT(f.entity_id) = 1
              THEN MIN(f.field_grievance_shop_target_id) END AS employer_nid
  FROM unresolved AS u
  LEFT JOIN field_data_field_grievance_shop AS f
    ON f.entity_id = u.nid AND f.entity_type = 'node'
   AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY u.nid
),
incoming AS (
  SELECT u.nid,
         COUNT(DISTINCT CASE WHEN h.deleted = 0 AND p.nid IS NOT NULL
                             THEN p.nid END) AS current_smf_parents_any_handler_bundle,
         COUNT(DISTINCT CASE WHEN h.deleted <> 0 AND p.nid IS NOT NULL
                             THEN p.nid END) AS deleted_smf_handler_parents,
         COUNT(DISTINCT CASE WHEN h.deleted = 0 AND owner.type = 'sirius_log'
            AND EXISTS (
              SELECT 1 FROM field_data_field_sirius_category AS cat
              WHERE cat.entity_type = 'node' AND cat.bundle = 'sirius_log'
                AND cat.deleted = 0 AND cat.entity_id = owner.nid
                AND cat.field_sirius_category_value = 'feed:prior'
            ) THEN owner.nid END) AS current_prior_file_logs,
         COUNT(DISTINCT CASE WHEN h.deleted = 0 AND owner.type = 'sirius_log'
                             THEN owner.nid END) AS all_current_log_owners,
         COUNT(DISTINCT CASE WHEN h.deleted = 0 AND owner.nid IS NULL
                             THEN h.entity_id END) AS missing_current_handler_owners
  FROM unresolved AS u
  LEFT JOIN field_data_field_sirius_log_handler AS h
    ON h.field_sirius_log_handler_target_id = u.nid AND h.entity_type = 'node'
  LEFT JOIN node AS owner ON owner.nid = h.entity_id
  LEFT JOIN parents AS p ON p.nid = owner.nid
  GROUP BY u.nid
),
archived_links AS (
  -- Only the no-current-parent cohort. A retained revision is evidence to
  -- inspect, not permission to combine current notes with an old handler.
  -- Category and feed handler must belong to the SAME retained revision.
  SELECT u.nid, COUNT(DISTINCT h.entity_id) AS archived_smf_parents,
         COUNT(DISTINCT h.entity_id, h.revision_id) AS archived_smf_parent_revisions,
         SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT h.entity_id ORDER BY h.entity_id
                                     SEPARATOR ','), ',', 5) AS sample_archived_parent_nids_up_to_5
  FROM unresolved AS u
  JOIN field_revision_field_sirius_log_handler AS h
    ON h.field_sirius_log_handler_target_id = u.nid
   AND h.entity_type = 'node' AND h.bundle = 'sirius_log' AND h.deleted = 0
  JOIN node_revision AS nr ON nr.nid = h.entity_id AND nr.vid = h.revision_id
  WHERE u.parent_count = 0
    AND EXISTS (
      SELECT 1 FROM field_revision_field_sirius_category AS cat
      WHERE cat.entity_type = 'node' AND cat.bundle = 'sirius_log'
        AND cat.deleted = 0 AND cat.entity_id = h.entity_id
        AND cat.revision_id = h.revision_id
        AND cat.field_sirius_category_value = 'smf:ehrs'
    )
  GROUP BY u.nid
)
SELECT 'Q17-unresolved-source-links' AS query_label,
       (SELECT COUNT(*) FROM candidates) AS current_candidate_feed_count,
       COUNT(*) OVER () AS diagnostic_feed_count,
       u.nid AS feed_nid,
       CASE WHEN u.source_type = 'sirius_smf_feed_ehrs'
            THEN 'MAIN' ELSE 'CORRECTION' END AS source_type,
       u.parent_count, u.parent_nid,
       u.live_employer_handler_rows, u.distinct_live_employers,
       k.key_rows, k.key_employer_nid, k.reporting_year, k.reporting_month,
       CASE WHEN k.key_employer_nid IS NULL THEN 'NO_VALID_KEY'
            WHEN ke.nid IS NULL THEN 'MISSING_NODE'
            WHEN ke.type = 'grievance_shop' THEN 'LIVE_EMPLOYER'
            ELSE 'OTHER_BUNDLE' END AS key_employer_state,
       (SELECT COUNT(*) FROM node_revision AS nr
        WHERE nr.nid = k.key_employer_nid) AS key_nid_retained_revisions_not_type_proof,
       (SELECT COUNT(*) FROM field_data_field_sirius_log_handler AS h
        WHERE h.entity_type = 'node' AND h.bundle = 'sirius_log'
          AND h.entity_id = u.parent_nid AND h.deleted = 0
          AND h.field_sirius_log_handler_target_id = k.key_employer_nid)
         AS live_handler_rows_to_key_nid,
       (SELECT COUNT(*) FROM field_data_field_sirius_log_handler AS h
        WHERE h.entity_type = 'node' AND h.bundle = 'sirius_log'
          AND h.entity_id = u.parent_nid AND h.deleted <> 0
          AND h.field_sirius_log_handler_target_id = k.key_employer_nid)
         AS deleted_handler_rows_to_key_nid,
       (SELECT COUNT(*) FROM field_data_field_sirius_log_handler AS h
        LEFT JOIN node AS target ON target.nid = h.field_sirius_log_handler_target_id
        WHERE h.entity_type = 'node' AND h.bundle = 'sirius_log'
          AND h.entity_id = u.parent_nid AND h.deleted = 0 AND target.nid IS NULL)
         AS parent_handler_rows_to_missing_nodes,
       fe.field_rows AS feed_employer_field_rows, fe.employer_nid AS feed_employer_nid,
       CASE WHEN fe.employer_nid IS NULL THEN 'NO_UNIQUE_REF'
            WHEN fee.nid IS NULL THEN 'MISSING_NODE'
            WHEN fee.type = 'grievance_shop' THEN 'LIVE_EMPLOYER'
            ELSE 'OTHER_BUNDLE' END AS feed_employer_state,
       CASE WHEN fe.employer_nid IS NULL OR k.key_employer_nid IS NULL THEN NULL
            ELSE fe.employer_nid = k.key_employer_nid END AS feed_ref_matches_key,
       i.current_smf_parents_any_handler_bundle, i.deleted_smf_handler_parents,
       i.current_prior_file_logs, i.all_current_log_owners, i.missing_current_handler_owners,
       COALESCE(a.archived_smf_parents, 0) AS archived_smf_parents,
       COALESCE(a.archived_smf_parent_revisions, 0) AS archived_smf_parent_revisions,
       a.sample_archived_parent_nids_up_to_5
FROM unresolved AS u
JOIN keys_parsed AS k ON k.nid = u.nid
JOIN feed_employers AS fe ON fe.nid = u.nid
JOIN incoming AS i ON i.nid = u.nid
LEFT JOIN node AS ke ON ke.nid = k.key_employer_nid
LEFT JOIN node AS fee ON fee.nid = fe.employer_nid
LEFT JOIN archived_links AS a ON a.nid = u.nid
ORDER BY u.parent_count, u.nid
LIMIT 200;

ROLLBACK;

-- Q16: Actual employer/period/status linkage for the two employer-hours types.
-- Authorized S1 MariaDB 10.6, READ ONLY. Run the WHOLE file on one connection.
-- Output: aggregates, reporting year/month, and bounded feed-NID samples only.
-- NO names, raw notes/JSON, file paths, row contents, credentials, or amounts.
-- No source record is changed. On error: stop and ROLLBACK.
-- This inventories source evidence; it does not import or approve any record.
-- Review before sharing. NID samples are identifiers, not personal field values.

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
  SELECT n.nid, n.created, t.source_type
  FROM node AS n JOIN types AS t ON t.entity_id = n.nid
  WHERE n.type = 'sirius_feed' AND t.field_rows = 1
    AND t.source_type IN ('sirius_smf_feed_ehrs', 'sirius_smf_feed_ehrs_correction')
),
statuses AS (
  SELECT f.entity_id, COUNT(*) AS field_rows,
         MIN(f.field_sirius_feed_status_value) AS source_status
  FROM field_data_field_sirius_feed_status AS f
  JOIN candidates AS c ON c.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
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
parent_categories AS (
  SELECT f.entity_id, COUNT(*) AS field_rows
  FROM field_data_field_sirius_category AS f
  JOIN parents AS p ON p.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_log' AND f.deleted = 0
  GROUP BY f.entity_id
),
feed_parents AS (
  SELECT c.nid AS feed_nid, COUNT(DISTINCT p.nid) AS parent_count,
         COUNT(*) AS handler_rows, MIN(p.nid) AS parent_nid
  FROM candidates AS c
  JOIN field_data_field_sirius_log_handler AS h
    ON h.field_sirius_log_handler_target_id = c.nid
   AND h.entity_type = 'node' AND h.bundle = 'sirius_log' AND h.deleted = 0
  JOIN parents AS p ON p.nid = h.entity_id
  GROUP BY c.nid
),
parent_notes AS (
  SELECT f.entity_id, COUNT(*) AS field_rows,
         MIN(f.field_sirius_notes_value) AS period_key
  FROM field_data_field_sirius_notes AS f
  JOIN parents AS p ON p.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_log' AND f.deleted = 0
  GROUP BY f.entity_id
),
parent_employers AS (
  SELECT p.nid AS parent_nid, COUNT(*) AS employer_handler_rows,
         MIN(e.nid) AS employer_nid
  FROM parents AS p
  JOIN field_data_field_sirius_log_handler AS h
    ON h.entity_id = p.nid AND h.entity_type = 'node'
   AND h.bundle = 'sirius_log' AND h.deleted = 0
  JOIN node AS e ON e.nid = h.field_sirius_log_handler_target_id
    AND e.type = 'grievance_shop'
  GROUP BY p.nid
),
feed_employers AS (
  SELECT f.entity_id, COUNT(*) AS field_rows,
         MIN(f.field_grievance_shop_target_id) AS employer_nid
  FROM field_data_field_grievance_shop AS f
  JOIN candidates AS c ON c.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
),
payloads AS (
  SELECT f.entity_id, COUNT(*) AS field_rows,
         MIN(CASE WHEN JSON_VALID(f.field_sirius_json_value)
                  THEN f.field_sirius_json_value ELSE NULL END) AS payload
  FROM field_data_field_sirius_json AS f
  JOIN candidates AS c ON c.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
),
evidence AS (
  SELECT c.nid, c.created, c.source_type, s.source_status,
         COALESCE(fp.parent_count, 0) AS parent_count,
         pe.employer_nid,
         CASE WHEN pn.field_rows = 1 AND
           pn.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$'
           THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(pn.period_key, '/', 2), '/', -1)
                     AS UNSIGNED) ELSE NULL END AS reporting_year,
         CASE WHEN pn.field_rows = 1 AND
           pn.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$'
           THEN CAST(SUBSTRING_INDEX(pn.period_key, '/', -1) AS UNSIGNED)
           ELSE NULL END AS reporting_month,
         CASE
           WHEN COALESCE(fp.parent_count, 0) = 0 THEN 'NO_PARENT'
           WHEN fp.parent_count <> 1 THEN 'MULTIPLE_PARENTS'
           WHEN fp.handler_rows <> 1 THEN 'DUPLICATE_FEED_HANDLER_ROWS'
           WHEN pc.field_rows <> 1 THEN 'AMBIGUOUS_PARENT_CATEGORY'
           WHEN COALESCE(pn.field_rows, 0) <> 1 THEN 'MISSING_OR_AMBIGUOUS_PERIOD_KEY'
           WHEN NOT (pn.period_key REGEXP '^[1-9][0-9]*/[12][0-9]{3}/(0?[1-9]|1[0-2])$')
             OR pn.period_key IS NULL THEN 'INVALID_PERIOD_KEY'
           WHEN COALESCE(pe.employer_handler_rows, 0) <> 1
             THEN 'MISSING_OR_AMBIGUOUS_LIVE_PARENT_EMPLOYER'
           WHEN CAST(SUBSTRING_INDEX(pn.period_key, '/', 1) AS UNSIGNED)
                <> pe.employer_nid THEN 'KEY_EMPLOYER_DISAGREES_WITH_HANDLER'
           WHEN COALESCE(s.field_rows, 0) <> 1 THEN 'MISSING_OR_AMBIGUOUS_STATUS'
           WHEN s.source_status IS NULL OR
                BINARY s.source_status NOT IN (BINARY 'complete', BINARY 'draft')
             THEN 'UNSUPPORTED_STATUS'
           WHEN c.created IS NULL OR c.created <= 0 THEN 'INVALID_CREATED_TIMESTAMP'
           ELSE 'SOURCE_LINKS_RESOLVED'
         END AS link_class,
         CASE WHEN COALESCE(fe.field_rows, 0) = 0 THEN 'NO_FEED_EMPLOYER'
              WHEN fe.field_rows <> 1 THEN 'MULTIPLE_FEED_EMPLOYER_ROWS'
              WHEN fe.employer_nid = pe.employer_nid THEN 'MATCHES_PARENT'
              ELSE 'DIFFERS_FROM_PARENT_OR_PARENT_UNRESOLVED' END AS feed_employer_class,
         COALESCE(j.field_rows, 0) AS json_field_rows,
         JSON_EXTRACT(j.payload,
           CONCAT('$.wizard.', JSON_QUOTE(c.source_type), '.steps.post.complete')) AS post_complete,
         JSON_EXTRACT(j.payload,
           CONCAT('$.wizard.', JSON_QUOTE(c.source_type), '.steps.review.complete')) AS review_complete
  FROM candidates AS c
  LEFT JOIN statuses AS s ON s.entity_id = c.nid
  LEFT JOIN feed_parents AS fp ON fp.feed_nid = c.nid
  LEFT JOIN parent_categories AS pc ON pc.entity_id = fp.parent_nid
  LEFT JOIN parent_notes AS pn ON pn.entity_id = fp.parent_nid
  LEFT JOIN parent_employers AS pe ON pe.parent_nid = fp.parent_nid
  LEFT JOIN feed_employers AS fe ON fe.entity_id = c.nid
  LEFT JOIN payloads AS j ON j.entity_id = c.nid
),
classified AS (
  SELECT e.*,
         CASE WHEN link_class = 'SOURCE_LINKS_RESOLVED' AND
                   reporting_year NOT BETWEEN 1900 AND 2100
              THEN 'REPORTING_YEAR_OUT_OF_RANGE' ELSE link_class END AS result_class,
         CASE WHEN JSON_TYPE(post_complete) = 'BOOLEAN'
              THEN JSON_UNQUOTE(post_complete) ELSE 'MISSING_OR_NONBOOLEAN' END AS post_flag,
         CASE WHEN JSON_TYPE(review_complete) = 'BOOLEAN'
              THEN JSON_UNQUOTE(review_complete) ELSE 'MISSING_OR_NONBOOLEAN' END AS review_flag
  FROM evidence AS e
),
attempts AS (
  SELECT c.*,
         CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED'
              THEN COUNT(*) OVER (
                PARTITION BY result_class, employer_nid, reporting_year, reporting_month
              ) ELSE NULL END AS attempts_in_employer_period
  FROM classified AS c
)
SELECT 'Q16-source-link-reconciliation' AS query_label,
       source_type, source_status, result_class, parent_count,
       CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED' THEN reporting_year END AS reporting_year,
       CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED' THEN reporting_month END AS reporting_month,
       feed_employer_class, json_field_rows, post_flag, review_flag,
       COUNT(*) AS feed_nodes,
       COUNT(DISTINCT CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED'
                           THEN employer_nid END) AS resolved_employers,
       SUM(CASE WHEN attempts_in_employer_period > 1 THEN 1 ELSE 0 END)
         AS feeds_in_periods_with_multiple_attempts,
       MIN(created) AS earliest_created_epoch, MAX(created) AS latest_created_epoch,
       SUBSTRING_INDEX(GROUP_CONCAT(nid ORDER BY nid SEPARATOR ','), ',', 5)
         AS sample_feed_nids_up_to_5
FROM attempts
GROUP BY source_type, source_status, result_class, parent_count,
         CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED' THEN reporting_year END,
         CASE WHEN result_class = 'SOURCE_LINKS_RESOLVED' THEN reporting_month END,
         feed_employer_class, json_field_rows, post_flag, review_flag
ORDER BY result_class, source_type, reporting_year, reporting_month,
         source_status, feed_employer_class, post_flag, review_flag;

ROLLBACK;

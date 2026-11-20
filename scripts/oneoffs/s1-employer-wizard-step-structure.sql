-- Data Migration: Employer Wizards — fixed-step structure, read-only.
-- Run on the authorized S1 MariaDB 10.6 connection, then review Q15 output.
-- Returns key names/shapes/counts only. No step VALUES, HTML, filenames,
-- uploaded rows, employer/worker records, or credentials are selected.
-- Do not share unexpected sensitive strings used as object KEY NAMES.
-- Dynamic per-worker steps are excluded. Arrays are never expanded.
-- On error, stop and ROLLBACK. Do not leave an inspection transaction open.

START TRANSACTION READ ONLY;

WITH
payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
),
roots AS (
  SELECT _utf8mb4'sirius_smf_feed_ehrs' COLLATE utf8mb4_bin AS root_key
  UNION ALL
  SELECT _utf8mb4'sirius_smf_feed_ehrs_correction' COLLATE utf8mb4_bin
),
step_names AS (
  SELECT _utf8mb4'upload' COLLATE utf8mb4_bin AS step_key
  UNION ALL SELECT _utf8mb4'map' COLLATE utf8mb4_bin
  UNION ALL SELECT _utf8mb4'verify' COLLATE utf8mb4_bin
  UNION ALL SELECT _utf8mb4'post' COLLATE utf8mb4_bin
  UNION ALL SELECT _utf8mb4'process' COLLATE utf8mb4_bin
  UNION ALL SELECT _utf8mb4'review' COLLATE utf8mb4_bin
  UNION ALL SELECT _utf8mb4'statement' COLLATE utf8mb4_bin
),
steps AS (
  SELECT p.entity_id, r.root_key, s.step_key,
         JSON_EXTRACT(p.payload,
           CONCAT('$.wizard.', JSON_QUOTE(r.root_key), '.steps.', JSON_QUOTE(s.step_key))) AS step
  FROM payloads AS p CROSS JOIN roots AS r CROSS JOIN step_names AS s
),
level1 AS (
  SELECT s.entity_id, s.root_key, s.step_key,
         CONVERT(CONCAT('$.', JSON_QUOTE(k.key_name)) USING utf8mb4)
           COLLATE utf8mb4_bin AS key_path,
         k.key_name AS leaf_key,
         JSON_EXTRACT(s.step, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM steps AS s
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(s.step) = 'OBJECT' THEN JSON_KEYS(s.step) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
),
level2 AS (
  SELECT p.entity_id, p.root_key, p.step_key,
         CONVERT(CONCAT(p.key_path, '.', JSON_QUOTE(k.key_name)) USING utf8mb4)
           COLLATE utf8mb4_bin AS key_path,
         k.key_name AS leaf_key,
         JSON_EXTRACT(p.member, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM level1 AS p
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(p.member) = 'OBJECT'
      AND LOWER(p.leaf_key) NOT IN
        ('records', 'rows', 'workers', 'employees', 'contacts', 'feed',
         'parsed', 'already_seen', 'results', 'errors', 'warnings')
      THEN JSON_KEYS(p.member) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
),
level3 AS (
  SELECT p.entity_id, p.root_key, p.step_key,
         CONVERT(CONCAT(p.key_path, '.', JSON_QUOTE(k.key_name)) USING utf8mb4)
           COLLATE utf8mb4_bin AS key_path,
         k.key_name AS leaf_key,
         JSON_EXTRACT(p.member, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM level2 AS p
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(p.member) = 'OBJECT'
      AND LOWER(p.leaf_key) NOT IN
        ('records', 'rows', 'workers', 'employees', 'contacts', 'feed',
         'parsed', 'already_seen', 'results', 'errors', 'warnings')
      THEN JSON_KEYS(p.member) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
),
shapes AS (
  SELECT entity_id,
         CONVERT(root_key USING utf8mb4) COLLATE utf8mb4_bin AS root_key,
         CONVERT(step_key USING utf8mb4) COLLATE utf8mb4_bin AS step_key,
         1 AS depth,
         CONVERT(key_path USING utf8mb4) COLLATE utf8mb4_bin AS key_path,
         CONVERT(JSON_TYPE(member) USING utf8mb4) COLLATE utf8mb4_bin AS value_shape
  FROM level1
  UNION ALL
  SELECT entity_id,
         CONVERT(root_key USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(step_key USING utf8mb4) COLLATE utf8mb4_bin, 2,
         CONVERT(key_path USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(JSON_TYPE(member) USING utf8mb4) COLLATE utf8mb4_bin
  FROM level2
  UNION ALL
  SELECT entity_id,
         CONVERT(root_key USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(step_key USING utf8mb4) COLLATE utf8mb4_bin, 3,
         CONVERT(key_path USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(JSON_TYPE(member) USING utf8mb4) COLLATE utf8mb4_bin
  FROM level3
)
SELECT 'Q15-fixed-step-key-shapes' AS query_label,
       root_key, step_key, depth, key_path, value_shape,
       COUNT(DISTINCT entity_id) AS feed_nodes
FROM shapes
GROUP BY root_key, step_key, depth, key_path, value_shape
ORDER BY root_key, step_key, depth, key_path, value_shape;

ROLLBACK;

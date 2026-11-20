-- Data Migration: Employer Wizards — targeted third Beekeeper pass.
-- MariaDB 10.6, READ ONLY. Run the WHOLE file on one authorized connection.
-- This fixes Q11's alphabetical 300-group cutoff by selecting the two
-- candidate hours roots explicitly, with NO result cap.
-- Only type/status/key NAMES, value SHAPES, and aggregate flags are returned.
-- Review all source-authored strings before sharing; key names can be sensitive.
-- No raw JSON, paths, original filenames, uploaded rows, or HTML are selected.
-- If any query fails, stop, ROLLBACK, and share its label and safe error.

START TRANSACTION READ ONLY;

-- Q12: Source-type vs payload-root matrix, including missing/mismatched roots.
-- Roots are not assumed to agree with the node's type field.
WITH
types AS (
  SELECT f.entity_id, MIN(f.field_sirius_type_value) AS source_type
  FROM field_data_field_sirius_type AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id HAVING COUNT(*) = 1
),
payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
)
SELECT 'Q12-hours-root-matrix' AS query_label, t.source_type, k.root_key,
       COUNT(DISTINCT t.entity_id) AS feed_nodes
FROM types AS t
LEFT JOIN payloads AS p ON p.entity_id = t.entity_id
LEFT JOIN JSON_TABLE(
  CASE WHEN JSON_TYPE(JSON_EXTRACT(p.payload, '$.wizard')) = 'OBJECT'
       THEN JSON_KEYS(JSON_EXTRACT(p.payload, '$.wizard')) ELSE '[]' END,
  '$[*]' COLUMNS (root_key TEXT PATH '$')
) AS k ON TRUE
WHERE t.source_type IN ('sirius_smf_feed_ehrs', 'sirius_smf_feed_ehrs_correction')
   OR k.root_key IN ('sirius_smf_feed_ehrs', 'sirius_smf_feed_ehrs_correction')
GROUP BY t.source_type, HEX(t.source_type), k.root_key, HEX(k.root_key)
ORDER BY t.source_type, k.root_key;

-- Q13: All immediate key names under the two hours roots (formerly Q11).
-- Also inspect child OBJECT keys only for named workflow/period containers,
-- never feed/results/data objects that could hold employee-indexed records.
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
hours AS (
  SELECT p.entity_id, r.root_key,
         JSON_EXTRACT(p.payload, CONCAT('$.wizard.', JSON_QUOTE(r.root_key))) AS wizard
  FROM payloads AS p CROSS JOIN roots AS r
),
members AS (
  SELECT h.entity_id, h.root_key, k.key_name,
         JSON_EXTRACT(h.wizard, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM hours AS h
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(h.wizard) = 'OBJECT'
         THEN JSON_KEYS(h.wizard) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
),
key_shapes AS (
  -- Normalize EVERY text projection on BOTH arms. JSON functions,
  -- JSON_TABLE columns, and connection-default CASTs can carry different
  -- collations in MariaDB even when the underlying characters are identical.
  SELECT entity_id,
         CONVERT(root_key USING utf8mb4) COLLATE utf8mb4_bin AS root_key,
         1 AS depth,
         CONVERT(key_name USING utf8mb4) COLLATE utf8mb4_bin AS parent_key,
         CAST(NULL AS CHAR(512) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin AS child_key,
         CONVERT(JSON_TYPE(member) USING utf8mb4) COLLATE utf8mb4_bin AS value_shape
  FROM members
  UNION ALL
  SELECT m.entity_id,
         CONVERT(m.root_key USING utf8mb4) COLLATE utf8mb4_bin,
         2,
         CONVERT(m.key_name USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(k.child_key USING utf8mb4) COLLATE utf8mb4_bin,
         CONVERT(JSON_TYPE(JSON_EXTRACT(m.member, CONCAT('$.', JSON_QUOTE(k.child_key))))
           USING utf8mb4) COLLATE utf8mb4_bin
  FROM members AS m
  JOIN JSON_TABLE(
    CASE WHEN m.key_name IN
      ('steps', 'parameters', 'arguments', 'args', 'inputs', 'options',
       'period', 'reporting_period', 'payperiod', 'employer', 'settings')
      AND JSON_TYPE(m.member) = 'OBJECT'
      THEN JSON_KEYS(m.member) ELSE '[]' END,
    '$[*]' COLUMNS (child_key TEXT PATH '$')
  ) AS k ON TRUE
)
SELECT 'Q13-hours-key-shapes' AS query_label, root_key, depth,
       parent_key, child_key, value_shape,
       COUNT(DISTINCT entity_id) AS feed_nodes
FROM key_shapes
GROUP BY root_key, depth, parent_key, HEX(parent_key),
         child_key, HEX(child_key), value_shape
ORDER BY root_key, depth, parent_key, child_key, value_shape;

-- Q14: Is process_ts present as a positive integer in the MATCHING root?
-- This is supporting evidence only; it does NOT declare success semantics.
WITH
types AS (
  SELECT f.entity_id, MIN(f.field_sirius_type_value) AS source_type
  FROM field_data_field_sirius_type AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id HAVING COUNT(*) = 1
),
statuses AS (
  SELECT f.entity_id, MIN(f.field_sirius_feed_status_value) AS source_status
  FROM field_data_field_sirius_feed_status AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id HAVING COUNT(*) = 1
),
payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
),
attempts AS (
  SELECT t.entity_id, t.source_type, s.source_status,
         JSON_EXTRACT(p.payload,
           CONCAT('$.wizard.', JSON_QUOTE(t.source_type), '.process_ts')) AS process_ts
  FROM types AS t
  LEFT JOIN statuses AS s ON s.entity_id = t.entity_id
  LEFT JOIN payloads AS p ON p.entity_id = t.entity_id
  WHERE t.source_type IN ('sirius_smf_feed_ehrs', 'sirius_smf_feed_ehrs_correction')
)
SELECT 'Q14-hours-processing-evidence' AS query_label, source_type, source_status,
       COALESCE(JSON_TYPE(process_ts), 'MISSING') AS process_ts_shape,
       CASE WHEN JSON_TYPE(process_ts) = 'INTEGER'
            THEN CASE WHEN CAST(JSON_UNQUOTE(process_ts) AS DECIMAL(30, 0)) > 0
                      THEN 'POSITIVE_INTEGER' ELSE 'NONPOSITIVE_INTEGER' END
            ELSE 'NOT_A_CONFIRMED_POSITIVE_INTEGER' END AS process_ts_class,
       COUNT(*) AS joined_rows, COUNT(DISTINCT entity_id) AS feed_nodes
FROM attempts
GROUP BY source_type, HEX(source_type), source_status, HEX(source_status),
         COALESCE(JSON_TYPE(process_ts), 'MISSING'),
         CASE WHEN JSON_TYPE(process_ts) = 'INTEGER'
              THEN CASE WHEN CAST(JSON_UNQUOTE(process_ts) AS DECIMAL(30, 0)) > 0
                        THEN 'POSITIVE_INTEGER' ELSE 'NONPOSITIVE_INTEGER' END
              ELSE 'NOT_A_CONFIRMED_POSITIVE_INTEGER' END
ORDER BY source_type, source_status, process_ts_shape, process_ts_class;

ROLLBACK;

-- Data Migration: Employer Wizards — source-authority inventory, first pass.
-- Run in Beekeeper against the authorized S1 MariaDB 10.6 source.
-- SELECTs only, inside a READ ONLY transaction; no staging or application writes.
-- Run the whole file on one connection. If any statement fails, stop, ROLLBACK,
-- and share the query label and error (not connection details).
--
-- Share the result tables with their Q labels after reviewing them.
-- No titles, names, JSON values, file paths, URLs, serialized config, file bytes,
-- users, or credentials are selected. Type/status/importer ids and JSON KEY
-- NAMES are source-authored strings: review those too and redact any unexpected
-- personal data or credentials before sharing. Do not share an unreviewed export.
-- Counts describe this snapshot, not migration success or an approved mapping.
-- No query here treats node.status as processing status.

START TRANSACTION READ ONLY;

-- Q1: Server compatibility and session timestamp interpretation.
SELECT 'Q1-server' AS query_label,
       VERSION() AS server_version,
       @@session.time_zone AS session_time_zone,
       @@system_time_zone AS system_time_zone;

-- Q2: Current node census; timestamps remain Unix epochs (no zone conversion).
SELECT 'Q2-node-census' AS query_label, type AS bundle,
       COUNT(*) AS nodes,
       SUM(status = 0) AS unpublished_nodes,
       SUM(status = 1) AS published_nodes,
       MIN(created) AS earliest_created_epoch,
       MAX(created) AS latest_created_epoch,
       SUM(created IS NULL OR created <= 0) AS missing_or_zero_created,
       SUM(changed < created) AS changed_before_created
FROM node
WHERE type IN ('sirius_feed', 'sirius_employer_payperiod')
GROUP BY type
ORDER BY type;

-- Q3: Declared fields and their real columns, including period candidates.
-- Do NOT add fc.data or fci.data: those are serialized configuration blobs.
SELECT 'Q3-field-catalog' AS query_label,
       fci.bundle, fci.field_name, fc.type AS field_type, fc.cardinality,
       cols.column_name, cols.column_type
FROM field_config_instance AS fci
JOIN field_config AS fc ON fc.id = fci.field_id AND fc.deleted = 0
LEFT JOIN information_schema.columns AS cols
  ON cols.table_schema = DATABASE()
 AND cols.table_name = CONCAT('field_data_', fci.field_name)
WHERE fci.entity_type = 'node' AND fci.deleted = 0
  AND fci.bundle IN ('sirius_feed', 'sirius_employer_payperiod')
ORDER BY fci.bundle, fci.field_name, cols.ordinal_position;

-- Q4: Exact type/status combinations without multiplying repeatable fields.
-- A value is used only when EXACTLY ONE live field row exists for the node.
-- Missing/multiple rows are distinct structural cases, never silently "first".
WITH
feed AS (SELECT nid FROM node WHERE type = 'sirius_feed'),
types AS (
  SELECT f.entity_id, COUNT(*) AS n, MIN(f.field_sirius_type_value) AS value
  FROM field_data_field_sirius_type AS f
  JOIN feed ON feed.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
),
statuses AS (
  SELECT f.entity_id, COUNT(*) AS n, MIN(f.field_sirius_feed_status_value) AS value
  FROM field_data_field_sirius_feed_status AS f
  JOIN feed ON feed.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
),
employer_refs AS (
  SELECT f.entity_id, COUNT(*) AS n,
         MIN(f.field_grievance_shop_target_id) AS target_nid
  FROM field_data_field_grievance_shop AS f
  JOIN feed ON feed.nid = f.entity_id
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  GROUP BY f.entity_id
)
SELECT 'Q4-type-status' AS query_label,
       COALESCE(t.n, 0) AS type_field_rows,
       CASE WHEN t.n = 1 THEN t.value ELSE NULL END AS source_type,
       COALESCE(s.n, 0) AS status_field_rows,
       CASE WHEN s.n = 1 THEN s.value ELSE NULL END AS source_status,
       COUNT(*) AS feed_nodes,
       SUM(COALESCE(e.n, 0) = 0) AS missing_employer_ref,
       SUM(e.n > 1) AS multiple_employer_ref_rows,
       SUM(e.n = 1 AND employer.nid IS NULL) AS missing_employer_target,
       SUM(e.n = 1 AND employer.type = 'grievance_shop') AS valid_shop_targets,
       SUM(e.n = 1 AND employer.type <> 'grievance_shop') AS other_target_bundles
FROM feed
LEFT JOIN types AS t ON t.entity_id = feed.nid
LEFT JOIN statuses AS s ON s.entity_id = feed.nid
LEFT JOIN employer_refs AS e ON e.entity_id = feed.nid
LEFT JOIN node AS employer ON e.n = 1 AND employer.nid = e.target_nid
GROUP BY t.n, CASE WHEN t.n = 1 THEN t.value ELSE NULL END,
         HEX(CASE WHEN t.n = 1 THEN t.value ELSE NULL END),
         s.n, CASE WHEN s.n = 1 THEN s.value ELSE NULL END,
         HEX(CASE WHEN s.n = 1 THEN s.value ELSE NULL END)
ORDER BY type_field_rows, source_type, status_field_rows, source_status;

-- Q5: Language/delta anomalies on the fields used above and the JSON candidate.
-- Counts are FIELD ROWS, not attempt counts. Do not filter out anomalies.
WITH field_rows AS (
  SELECT 'type' AS field_name, f.entity_id, f.language, f.delta
  FROM field_data_field_sirius_type AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  UNION ALL
  SELECT 'feed_status', f.entity_id, f.language, f.delta
  FROM field_data_field_sirius_feed_status AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  UNION ALL
  SELECT 'employer', f.entity_id, f.language, f.delta
  FROM field_data_field_grievance_shop AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
  UNION ALL
  SELECT 'json', f.entity_id, f.language, f.delta
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
)
SELECT 'Q5-field-shape' AS query_label, field_name, language, delta,
       COUNT(*) AS field_rows, COUNT(DISTINCT entity_id) AS nodes
FROM field_rows
GROUP BY field_name, language, delta
ORDER BY field_name, language, delta;

-- Q6: JSON shape only. Invalid JSON is never passed to a parsing function.
WITH payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE NULL END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
)
SELECT 'Q6-json-shape' AS query_label,
       COALESCE(JSON_TYPE(payload), 'SQL_NULL_OR_INVALID') AS json_shape,
       COUNT(*) AS field_rows, COUNT(DISTINCT entity_id) AS nodes
FROM payloads
GROUP BY COALESCE(JSON_TYPE(payload), 'SQL_NULL_OR_INVALID')
ORDER BY json_shape;

-- Q7: Top-level JSON KEY NAMES only, never values. MariaDB 10.6 JSON_TABLE.
-- Review before sharing: a malformed design could use personal data as keys.
WITH payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
)
SELECT 'Q7-json-key-names' AS query_label, keys_found.key_name,
       COUNT(DISTINCT p.entity_id) AS nodes_with_key
FROM payloads AS p
JOIN JSON_TABLE(
  COALESCE(JSON_KEYS(p.payload), '[]'),
  '$[*]' COLUMNS (key_name VARCHAR(512) PATH '$')
) AS keys_found ON TRUE
GROUP BY keys_found.key_name, HEX(keys_found.key_name)
ORDER BY nodes_with_key DESC, keys_found.key_name
LIMIT 100;

-- Q8: Does Drupal Feeds actually point to sirius_feed nodes?
-- Only configuration ids and aggregates; no source/config/state/URL/GUID data.
SELECT 'Q8-feeds-linkage' AS query_label, 'feeds_source' AS source_table,
       f.id AS importer_id, COALESCE(n.type, 'NO_MATCHING_NODE') AS node_bundle,
       COUNT(*) AS source_rows, COUNT(DISTINCT f.feed_nid) AS distinct_feed_nids,
       SUM(f.feed_nid = 0) AS zero_feed_nid_rows,
       SUM(f.imported > 0) AS rows_with_imported_epoch
FROM feeds_source AS f
LEFT JOIN node AS n ON n.nid = f.feed_nid
GROUP BY f.id, n.type
UNION ALL
SELECT 'Q8-feeds-linkage', 'feeds_item', f.id,
       COALESCE(n.type, 'NO_MATCHING_NODE'),
       COUNT(*), COUNT(DISTINCT f.feed_nid),
       SUM(f.feed_nid = 0), SUM(f.imported > 0)
FROM feeds_item AS f
LEFT JOIN node AS n ON n.nid = f.feed_nid
GROUP BY f.id, n.type;

ROLLBACK;

-- STOP HERE. These results do not yet prove processing semantics, period
-- authority, or retry identity. The next bounded query will be tailored to
-- the discovered types and period keys. Do not export the underlying JSON,
-- files, feeds config/state, log messages, or raw example records.

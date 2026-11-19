-- Data Migration: Employer Wizards — second read-only Beekeeper pass.
-- S1 MariaDB 10.6. Run the whole file on ONE authorized connection.
-- No payload VALUES are returned: only source type/status, JSON key names,
-- JSON shapes, and counts. Review all source-authored strings before sharing.
-- A JSON key itself can contain personal data; redact unexpected sensitive keys.
-- Do not replace any expression with SELECT payload, SELECT wizard, or SELECT *.
-- On any error: stop, ROLLBACK, and share only the query label and safe error.
-- Each result is capped at 300 groups; exactly 300 means potentially incomplete.
-- We inspect objects only, never arrays of uploaded row contents.

START TRANSACTION READ ONLY;

-- Q9: Account for missing payloads and the shape of $.wizard by type/status.
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
              THEN f.field_sirius_json_value ELSE NULL END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
)
SELECT 'Q9-wizard-shape' AS query_label, t.source_type, s.source_status,
       CASE WHEN p.entity_id IS NULL THEN 'NO_JSON_FIELD'
            WHEN p.payload IS NULL THEN 'SQL_NULL_OR_INVALID'
            ELSE COALESCE(JSON_TYPE(JSON_EXTRACT(p.payload, '$.wizard')), 'NO_WIZARD_KEY')
       END AS wizard_shape,
       COUNT(*) AS joined_rows, COUNT(DISTINCT n.nid) AS feed_nodes
FROM node AS n
LEFT JOIN types AS t ON t.entity_id = n.nid
LEFT JOIN statuses AS s ON s.entity_id = n.nid
LEFT JOIN payloads AS p ON p.entity_id = n.nid
WHERE n.type = 'sirius_feed'
GROUP BY t.source_type, HEX(t.source_type), s.source_status, HEX(s.source_status),
         CASE WHEN p.entity_id IS NULL THEN 'NO_JSON_FIELD'
              WHEN p.payload IS NULL THEN 'SQL_NULL_OR_INVALID'
              ELSE COALESCE(JSON_TYPE(JSON_EXTRACT(p.payload, '$.wizard')), 'NO_WIZARD_KEY')
         END
ORDER BY t.source_type, s.source_status, wizard_shape
LIMIT 300;

-- Q10: Keys immediately below $.wizard, with their SHAPES (not values).
WITH payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
),
wizards AS (
  SELECT entity_id, JSON_EXTRACT(payload, '$.wizard') AS wizard
  FROM payloads
),
members AS (
  SELECT w.entity_id, k.key_name,
         JSON_EXTRACT(w.wizard, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM wizards AS w
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(w.wizard) = 'OBJECT'
         THEN JSON_KEYS(w.wizard) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
)
SELECT 'Q10-wizard-key-shapes' AS query_label, key_name,
       JSON_TYPE(member) AS value_shape,
       COUNT(DISTINCT entity_id) AS feed_nodes
FROM members
GROUP BY key_name, HEX(key_name), JSON_TYPE(member)
ORDER BY feed_nodes DESC, key_name, value_shape
LIMIT 300;

-- Q11: One more level of OBJECT key names, such as wizard.<key>.<child>.
-- Arrays are deliberately not expanded; no row values or row-level fields.
WITH payloads AS (
  SELECT f.entity_id,
         CASE WHEN JSON_VALID(f.field_sirius_json_value)
              THEN f.field_sirius_json_value ELSE '{}' END AS payload
  FROM field_data_field_sirius_json AS f
  JOIN node AS n ON n.nid = f.entity_id AND n.type = 'sirius_feed'
  WHERE f.entity_type = 'node' AND f.bundle = 'sirius_feed' AND f.deleted = 0
),
wizards AS (
  SELECT entity_id, JSON_EXTRACT(payload, '$.wizard') AS wizard
  FROM payloads
),
members AS (
  SELECT w.entity_id, k.key_name,
         JSON_EXTRACT(w.wizard, CONCAT('$.', JSON_QUOTE(k.key_name))) AS member
  FROM wizards AS w
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(w.wizard) = 'OBJECT'
         THEN JSON_KEYS(w.wizard) ELSE '[]' END,
    '$[*]' COLUMNS (key_name TEXT PATH '$')
  ) AS k ON TRUE
),
children AS (
  SELECT m.entity_id, m.key_name AS parent_key, k.child_key,
         JSON_TYPE(JSON_EXTRACT(m.member, CONCAT('$.', JSON_QUOTE(k.child_key)))) AS value_shape
  FROM members AS m
  JOIN JSON_TABLE(
    CASE WHEN JSON_TYPE(m.member) = 'OBJECT'
         THEN JSON_KEYS(m.member) ELSE '[]' END,
    '$[*]' COLUMNS (child_key TEXT PATH '$')
  ) AS k ON TRUE
)
SELECT 'Q11-wizard-child-key-shapes' AS query_label,
       parent_key, child_key, value_shape,
       COUNT(DISTINCT entity_id) AS feed_nodes
FROM children
GROUP BY parent_key, HEX(parent_key), child_key, HEX(child_key), value_shape
ORDER BY parent_key, feed_nodes DESC, child_key, value_shape
LIMIT 300;

ROLLBACK;

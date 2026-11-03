-- Mask Mode prerequisite inventory: metadata only.
-- Run against the actual LIVE S2 training database using your normal
-- authorized SQL tool. Do not change the connection or copy credentials here.
-- Run the entire block on ONE connection. It does not change application data.
-- Review the result tables before sharing: identifier labels/validators are
-- configuration metadata, but administrators can put arbitrary text in them.
-- Replace any unexpected personal information with [withheld].
-- Report errors as errors; do not substitute development results.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';

-- 1. Configured identifier types. NO worker_ids values are read.
-- Type UUIDs are configuration keys needed to classify runtime output.
SELECT
  id AS identifier_type_id,
  name AS type_label,
  sirius_id AS stable_alias,
  validator,
  CASE
    WHEN data->'showOnLists' IS NULL THEN 'not_configured'
    WHEN jsonb_typeof(data->'showOnLists') = 'boolean'
      THEN data->>'showOnLists'
    ELSE 'invalid_type'
  END AS show_on_lists
FROM options_worker_id_type
ORDER BY name, id;

-- 2a. Component override inventory status.
-- Missing/invalid configuration is not evidence that all components are off.
SELECT
  count(*) AS components_variable_rows,
  count(*) FILTER (WHERE jsonb_typeof(value) = 'object') AS object_rows
FROM variables
WHERE name = 'components';

-- 2b. Stored overrides ONLY. The live application's registry supplies defaults.
-- Also provide GET /api/components/config from an already authorized LIVE
-- session for the effective runtime componentId/enabled list.
-- No other variables or raw configuration values are selected.
SELECT
  entry.key AS component_id,
  CASE
    WHEN jsonb_typeof(entry.value) = 'boolean'
      THEN entry.value #>> '{}'
    ELSE 'invalid_type'
  END AS configured_enabled
FROM variables AS variable
CROSS JOIN LATERAL jsonb_each(
  CASE WHEN jsonb_typeof(variable.value) = 'object'
    THEN variable.value ELSE '{}'::jsonb END
) AS entry
WHERE variable.name = 'components'
ORDER BY entry.key;

-- 3. Plugin kinds and implementation IDs, with enablement counts.
-- Intentionally exclude names, aliases, data, URLs, templates, destinations,
-- credentials and all subsidiary-table payloads.
-- Includes client-injection rows without loading their code or attributes.
SELECT
  plugin_kind,
  plugin_id,
  count(*) AS configuration_count,
  count(*) FILTER (WHERE enabled IS TRUE) AS enabled_count,
  count(*) FILTER (WHERE enabled IS FALSE) AS disabled_count
FROM plugin_configs
GROUP BY plugin_kind, plugin_id
ORDER BY plugin_kind, plugin_id;

ROLLBACK;

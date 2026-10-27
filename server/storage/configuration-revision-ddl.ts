/**
 * Kept pure so disposable-database tests exercise the exact production DDL.
 * Triggers cover storage, raw SQL, cascading deletes and boot repairs alike.
 */
export const CONFIGURATION_REVISION_DDL = `
CREATE TABLE IF NOT EXISTS configuration_revisions (
  scope text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION configuration_variable_scope(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN name LIKE 'ENV\\_%' ESCAPE '\\' THEN 'environment'
    WHEN name = 'site_terminology' THEN 'terminology'
    WHEN name = 'system_mode' THEN 'maintenance'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION configuration_revision_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scopes text[];
  old_scope text;
  new_scope text;
  changed_scope text;
BEGIN
  IF TG_TABLE_NAME = 'variables' THEN
    IF TG_OP <> 'INSERT' THEN old_scope := configuration_variable_scope(OLD.name); END IF;
    IF TG_OP <> 'DELETE' THEN new_scope := configuration_variable_scope(NEW.name); END IF;
    scopes := ARRAY[old_scope, new_scope];
  ELSE
    scopes := ARRAY['plugins'];
    IF TG_TABLE_NAME = 'plugin_configs_cron' THEN
      scopes := array_append(scopes, 'cron');
    ELSIF TG_TABLE_NAME = 'plugin_configs' THEN
      IF TG_OP <> 'INSERT' THEN
        IF OLD.plugin_kind = 'cron' THEN scopes := array_append(scopes, 'cron'); END IF;
      END IF;
      IF TG_OP <> 'DELETE' THEN
        IF NEW.plugin_kind = 'cron' THEN scopes := array_append(scopes, 'cron'); END IF;
      END IF;
    END IF;
  END IF;
  -- Consistent row-lock order; arithmetic upsert cannot lose concurrent increments.
  FOR changed_scope IN SELECT DISTINCT s FROM unnest(scopes) AS s WHERE s IS NOT NULL ORDER BY s LOOP
    INSERT INTO configuration_revisions(scope, revision) VALUES(changed_scope, 1)
      ON CONFLICT(scope) DO UPDATE SET revision = configuration_revisions.revision + 1;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION install_configuration_revision_triggers() RETURNS void
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE table_name text;
BEGIN
  -- Component enable and boot can both install missing optional triggers.
  -- Serialize the check/create pair, without holding a session lock.
  PERFORM pg_advisory_xact_lock(1919191919);
  FOREACH table_name IN ARRAY ARRAY[
    'variables', 'plugin_configs', 'plugin_configs_charge',
    'plugin_configs_dashboard', 'plugin_configs_quicksearch',
    'plugin_configs_wc_vendors', 'plugin_configs_event_notifier',
    'plugin_configs_cron', 'plugin_configs_flood', 'plugin_configs_dispatch',
    'plugin_configs_benefit_eligibility', 'plugin_configs_trust_provider_edi'
  ] LOOP
    -- Optional component tables may not exist yet. Component schema creation
    -- calls this function before returning to its configuration backfill.
    IF to_regclass(table_name) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(table_name)
        AND tgname = 'configuration_revision_changed'
    ) THEN
      EXECUTE format('CREATE TRIGGER configuration_revision_changed AFTER INSERT OR UPDATE OR DELETE ON %I
        FOR EACH ROW EXECUTE FUNCTION configuration_revision_changed()', table_name);
    END IF;
  END LOOP;
END
$$;
SELECT install_configuration_revision_triggers();
`;

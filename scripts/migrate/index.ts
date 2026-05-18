// Core (global) migrations — tracked by the `migrations_version` variable.
// Anything under shared/schema.ts that is NOT owned by a component-schema
// manifest belongs here.
import "./core/001_component_cache";
import "./core/002_wizard_employment_status_mappings";
import "./core/002_create_ledger_table";
import "./core/003_rename_source_nid_to_external_id";
import "./core/004_add_clerk_auth_provider_type";
import "./core/005_add_edls_sheet_job_group";
import "./core/006_ledger_statement_ymd";
import "./core/002_drop_replit_user_id";

// Per-component migrations — each registered via
// `registerComponentMigration(componentId, migration)`. Tracked by the
// `component_schema_state_<component-id>.migrationVersion` field. Add new
// per-component migration files under `scripts/migrate/components/<id>/`
// and import them here so they are loaded at startup.
//
// (no component migrations registered yet — first author of a per-component
//  schema change should add their files here)

// Baseline scripts — one-off, per-deployment scripts that bring a database
// into sync with the schema BEFORE the drift gate runs. Baseline scripts
// are imported and registered as core migrations using a high version number
// reserved for baselining (>= 1000). They are idempotent on re-run. See
// `replit.md` → "Baselining a deployment" for the full procedure.
//
import "./baseline/sirius-dev-20260518";

export {
  runMigrations,
  getMigrationStatus,
  getMigrations,
  registerComponentMigration,
  runComponentMigrations,
  getComponentMigrations,
  getAllComponentMigrations,
} from "../../server/services/migration-runner";

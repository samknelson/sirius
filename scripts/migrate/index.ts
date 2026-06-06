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
import "./core/1004_create_options_comm_tags";
import "./core/1005_create_comm_tags";
import "./core/1006_comm_postal_body";
import "./core/1007_add_edls_sheet_facility_fk";
import "./core/1008_add_trust_benefit_sirius_id";
import "./core/1009_add_benefit_type_sirius_id";
import "./core/1010_add_worker_trust_elections_employer_id";
import "./core/1011_add_workers_data";
import "./core/1012_employer_sirius_id_varchar";
import "./core/1013_charge_plugin_account_name_states";
import "./core/1014_drop_charge_plugin_states";
import "./core/1015_create_plugin_configs";
import "./core/1016_backfill_charge_plugin_configs";
import "./core/1017_drop_charge_plugin_configs";
import "./core/1018_charge_subsidiary_plugin_id_unique";
import "./core/1019_backfill_trust_eligibility_configs";

// Per-component migrations — each registered via
// `registerComponentMigration(componentId, migration)`. Tracked by the
// `component_schema_state_<component-id>.migrationVersion` field. Add new
// per-component migration files under `scripts/migrate/components/<id>/`
// and import them here so they are loaded at startup.
//
import "./components/trust.benefits.eligibility.exemptions/001_create_exemptions";
import "./components/trust.benefits.eligibility.exemptions/002_require_benefit_and_plugins";
import "./components/sitespecific.bao/001_create_immediate_eligibility";

// Baseline scripts — one-off, per-deployment scripts that bring a database
// into sync with the schema BEFORE the drift gate runs. Baseline scripts
// are imported and registered as core migrations using a high version number
// reserved for baselining (>= 1000). They are idempotent on re-run. See
// `replit.md` → "Baselining a deployment" for the full procedure.
//
import "./baseline/sirius-dev-20260518";
import "./baseline/sirius-dev-20260524";

export {
  runMigrations,
  getMigrationStatus,
  getMigrations,
  registerComponentMigration,
  runComponentMigrations,
  getComponentMigrations,
  getAllComponentMigrations,
} from "../../server/services/migration-runner";

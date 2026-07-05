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
import "./core/1021_charge_account_required";
import "./core/1022_drop_charge_subsidiary_plugin_id";
import "./core/1023_add_plugin_configs_sirius_id";
import "./core/1024_drop_freeman_crewleads";
import "./core/1025_create_plugin_configs_dashboard";
import "./core/1026_create_plugin_configs_payment_gateway";
import "./core/1027_rename_ledger_payment_methods";
import "./core/1028_provider_generic_payment_methods";
import "./core/1029_rename_ledger_payment_type_variable";
import "./core/1030_rename_plugin_type_to_plugin_kind";
import "./core/1031_create_plugin_configs_event_notifier";
import "./core/1032_create_plugin_configs_cron";
import "./core/1033_backfill_cron_plugin_configs";
import "./core/1034_drop_cron_jobs";
import "./core/1035_plugin_configs_singleton_unique";
import "./core/1036_plugin_configs_singleton_per_type";
import "./core/1037_create_denorm";
import "./core/1038_worker_msh_denorm";
import "./core/1039_worker_wsh_denorm";
import "./core/1040_worker_employment_denorm";

// Per-component migrations — each registered via
// `registerComponentMigration(componentId, migration)`. Tracked by the
// `component_schema_state_<component-id>.migrationVersion` field. Add new
// per-component migration files under `scripts/migrate/components/<id>/`
// and import them here so they are loaded at startup.
//
import "./components/trust.benefits.eligibility.exemptions/001_create_exemptions";
import "./components/trust.benefits.eligibility.exemptions/002_require_benefit_and_plugins";
import "./components/sitespecific.bao/001_create_immediate_eligibility";
import "./components/sitespecific.freeman/001_create_crewleads";
import "./components/grievance/001_create_options_grievance_status";
import "./components/grievance/002_create_options_grievance_category";
import "./components/grievance/003_create_grievances";
import "./components/grievance/004_add_cardinality_to_grievances";
import "./components/grievance/005_add_primary_to_grievance_workers";
import "./components/grievance/006_add_class_description_to_grievances";
import "./components/grievance/007_add_sirius_id_and_open_to_options_grievance_status";
import "./components/grievance/008_add_sequence_to_options_grievance_status";
import "./components/grievance/009_create_options_grievance_steps";
import "./components/grievance/010_create_grievance_steps";
import "./components/grievance/011_create_grievance_timeline_templates";
import "./components/grievance/012_add_sequence_to_grievance_timeline_template_steps";
import "./components/grievance/013_add_timeline_template_id_to_grievances";
import "./components/grievance/014_create_options_grievance_complaints";
import "./components/grievance/015_create_options_grievance_remedies";
import "./components/grievance/016_create_grievance_complaints";
import "./components/grievance/017_create_grievance_remedies";
import "./components/grievance/018_drop_complaint_remedy_from_grievances";
import "./components/grievance/019_create_options_grievance_roles";
import "./components/grievance/020_create_grievance_users";
import "./components/grievance/021_add_sirius_id_to_grievances";
import "./components/grievance/022_create_grievance_name_denorm";
import "./components/grievance/023_grievance_sirius_id_unique_constraint";
import "./components/grievance/024_add_bargaining_unit_id_to_grievances";
import "./components/grievance/025_make_grievance_sirius_id_not_null";
import "./components/grievance.settlement/001_create_grievance_settlement";
import "./components/dispatch/001_backfill_dispatch_eligibility_configs";
import "./components/dispatch/002_worker_dispatch_elig_denorm_denorm_id";
import "./components/trust.benefits/001_backfill_trust_eligibility_configs";
import "./components/contract/001_create_contract_tables";

// Baseline scripts — one-off, per-deployment scripts that bring a database
// into sync with the schema BEFORE the drift gate runs. Baseline scripts
// are imported and registered as core migrations using a high version number
// reserved for baselining (>= 1000). They are idempotent on re-run. See
// `replit.md` → "Baselining a deployment" for the full procedure.
//
import "./baseline/sirius-dev-20260518";
import "./baseline/sirius-dev-20260524";
import "./baseline/sirius-dev-20260704";

export {
  runMigrations,
  getMigrationStatus,
  getMigrations,
  registerComponentMigration,
  runComponentMigrations,
  getComponentMigrations,
  getAllComponentMigrations,
} from "../../server/services/migration-runner";

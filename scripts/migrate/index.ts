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
import "./core/1043_ledger_payments_date_received_nullable";
import "./core/1044_create_ebs";
import "./core/1045_ebs_subject_and_purge";
import "./core/1046_add_edls_sheet_job_group_fk";
import "./core/1107_create_snapshots";
import "./core/1108_delete_legacy_cleanup_cron_configs";
import "./core/1109_create_business_calendars";
import "./core/1110_add_employer_business_calendar";
import "./core/1111_dashboard_roles_array";
import "./core/1112_add_dispatch_is_primary";
import "./core/1113_create_help";
import "./core/1114_options_event_type_sirius_id_nullable";
import "./core/1115_files_file_system_id";
import "./core/1116_add_trust_wmb_source_relation";
import "./core/1117_create_comm_interaction";
import "./core/1118_rename_member_status_scan_cron";
import "./core/1119_cleanup_resurrected_member_status_scan";

// Per-component migrations — each registered via
// `registerComponentMigration(componentId, migration)`. Tracked by the
// `component_schema_state_<component-id>.migrationVersion` field. Add new
// per-component migration files under `scripts/migrate/components/<id>/`
// and import them here so they are loaded at startup.
//
import "./components/trust.providers.edi/002_drop_legacy_table";
import "./components/trust.providers.edi/003_create_subsidiary_table";
import "./components/trust.benefits.eligibility.exemptions/001_create_exemptions";
import "./components/trust.benefits.eligibility.exemptions/002_require_benefit_and_plugins";
import "./components/sitespecific.bao/001_create_immediate_eligibility";
import "./components/sitespecific.bao/002_create_employer_rates";
import "./components/sitespecific.bao/003_create_rate_sources";
import "./components/sitespecific.bao/004_create_distance_cache";
import "./components/sitespecific.bao/005_create_cobra";
import "./components/sitespecific.bao/006_create_dp_rates";
import "./components/sitespecific.bao/007_create_premium_tables";
import "./components/sitespecific.bao/008_create_withholding_allocations";
import "./components/sitespecific.bao/009_create_notes_tags";
import "./components/sitespecific.bao/010_create_case_management";
import "./components/sitespecific.bao/011_create_disability_credit";
import "./components/sitespecific.bao/012_dc_case_workflow";
import "./components/sitespecific.bao/013_dc_grant_events";
import "./components/sitespecific.bao/014_dc_extensions_and_notes_retirement";
import "./components/sitespecific.bao/015_case_types_and_workflow_rules";
import "./components/sitespecific.bao/016_benefit_appeal_tables";
import "./components/sitespecific.bao/017_create_case_comms";
import "./components/sitespecific.bao/018_create_case_documents";
import "./components/sitespecific.bao/019_case_status_lapse";
import "./components/sitespecific.freeman/001_create_crewleads";
import "./components/sitespecific.freeman.edls_migrate/001_create_staging";
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
import "./components/grievance/026_add_employer_contact_id_to_grievances";
import "./components/grievance/027_create_grievance_status_history_drop_status_id";
import "./components/grievance/028_replace_grievance_steps_with_denorm";
import "./components/grievance.settlement/001_create_grievance_settlement";
import "./components/grievance.contract/001_create_grievance_contract_sections";
import "./components/grievance.contract/002_create_grievance_contracts";
import "./components/dispatch/001_backfill_dispatch_eligibility_configs";
import "./components/dispatch.fore/001_create_dispatch_job_fore";
import "./components/sitespecific.t631.interviews/001_create_job_interviews";
import "./components/dispatch.bullpen/001_create_dispatch_job_event";
import "./components/dispatch.department/001_create_department_tables";
import "./components/dispatch/002_worker_dispatch_elig_denorm_denorm_id";
import "./components/dispatch/003_create_dispatch_job_employer_contacts";
import "./components/trust.benefits/001_backfill_trust_eligibility_configs";
import "./components/trust.benefits/002_create_trust_wmb_events";
import "./components/contract/001_create_contract_tables";
import "./components/edls/001_add_show_status";
import "./components/edls/002_add_sheet_notes_and_change_tracking";
import "./components/edls/003_add_assignment_comm_id";
import "./components/edls/004_add_assignment_accepted";
import "./components/edls/005_add_sheet_notifications_enabled";
import "./components/worker.ratings/001_add_sirius_id_to_options_worker_ratings";
import "./components/trust.providers.edi/001_add_sftp_client_fk";
import "./components/trust.elections/001_add_enrollment_type";
import "./components/trust.elections/002_create_open_enrollment_windows";
import "./components/trust.elections/003_policy_id_nullable";
import "./components/worker.aat/001_create_worker_aat";

// Baseline scripts — one-off, per-deployment scripts that bring a database
// into sync with the schema BEFORE the drift gate runs. Baseline scripts
// are imported and registered as core migrations using a high version number
// reserved for baselining (>= 1000). They are idempotent on re-run. See
// `replit.md` → "Baselining a deployment" for the full procedure.
//
import "./baseline/sirius-dev-20260618";
import "./baseline/sirius-dev-20260518";
import "./baseline/sirius-dev-20260524";
import "./baseline/sirius-dev-20260618b";
import "./baseline/sirius-dev-20260704";
import "./baseline/sirius-dev-20260706";

// Re-apply of 1117, skipped on prod by the version-counter collision.
import "./core/1120_reapply_comm_interaction";
import "./core/1121_worker_hours_worker_id_index";
import "./core/1122_add_issue_reported_interaction_channel";
import "./core/1123_add_letter_interaction_channel";
import "./core/1124_add_provider_call_interaction_channel";
import "./core/1125_contacts_email_ci_unique";
import "./core/1126_add_contact_position";
import "./core/1127_reapply_merged_1056_1060";
import "./core/1128_delete_obsolete_worker_ban_cron_configs";
// Renumbered from 1041/1102-1106: their original versions were <= the shared
// migrations_version counter on databases that had already passed them, so
// the runner would silently skip them (see the 1117/1120 incident). All are
// idempotent, so re-running on databases that already applied them is safe.
import "./core/1129_add_trust_benefit_color";
import "./core/1130_add_trust_benefit_color";
import "./core/1131_add_trust_benefit_show_on_worker_list";
import "./core/1132_wmb_scan_scope";
import "./core/1133_reapply_ebs";
import "./core/1134_add_trust_benefit_provider";
// Merged from upstream main as 1061-1070. Renumbered above this fork's
// counter (1134) because upstream's numbers were already below the shared
// migrations_version on every database here and the runner would have
// silently skipped them (see the 1117/1120 incident). All are idempotent.
import "./core/1135_create_plugin_configs_quicksearch";
import "./core/1136_create_wc_cache";
import "./core/1137_backfill_wc_cache_phone_lookup";
import "./core/1138_backfill_wc_cache_address_verification";
import "./core/1139_create_wc_stats";
import "./core/1140_wc_stats_ymd";
import "./core/1141_create_ws_stats";
import "./core/1142_add_comm_send_key";
import "./core/1143_delete_web_usage_alert_scan_cron_config";
import "./core/1144_add_users_timezone";
// Merged from upstream main as 1071-1076 (entity files + notes -> entity_notes
// rename). Renumbered above this fork's counter (1144) for the same reason as
// the 1135-1144 block: upstream's numbers are below the shared
// migrations_version here and would be silently skipped. All are idempotent.
import "./core/1145_create_entity_files";
import "./core/1146_rename_notes_to_entity_notes";
import "./core/1147_rename_entity_notes_entity_type_to_context_id";
import "./core/1148_rename_trust_provider_file_context";
import "./core/1149_create_options_file_type";
import "./core/1150_rename_note_type_entity_types_key";

export {
  runMigrations,
  getMigrationStatus,
  getMigrations,
  registerComponentMigration,
  runComponentMigrations,
  getComponentMigrations,
  getAllComponentMigrations,
} from "../../server/services/migration-runner";

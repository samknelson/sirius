import { getTableName } from "drizzle-orm";
import { PgTable, type TableConfig } from "drizzle-orm/pg-core";
import * as coreSchema from "@shared/schema";
import * as t631InterviewSchema from "@shared/schema/sitespecific/t631/interviews-schema";
import {
  getLoggedTableNames,
  getModulesNamingTablesAtRuntime,
} from "./middleware/logging";
import { isMetadataTableEligible } from "./system/entity-metadata-policy";

/**
 * The metadata context registry is keyed by the stable value stored in
 * entity_metadata.context_id. The physical table is deliberately part of the
 * declaration rather than reconstructed by scanning the schema barrel: a
 * context id may differ from its table name in the future.
 */
export interface MetadataRecordContext {
  table: PgTable<TableConfig>;
  label: string;
  hrefTemplate: string | null;
}

const context = (
  table: PgTable<TableConfig>,
  label: string,
  hrefTemplate: string | null,
): MetadataRecordContext => ({ table, label, hrefTemplate });

export const entityMetadataContexts: Record<string, MetadataRecordContext> = {
  bargaining_units: context(coreSchema.bargainingUnits, "Bargaining Units", "/bargaining-units/{id}"),
  bookmarks: context(coreSchema.bookmarks, "Bookmarks", null),
  bulk_messages: context(coreSchema.bulkMessages, "Bulk Messages", "/bulk/{id}"),
  bulk_messages_email: context(coreSchema.bulkMessagesEmail, "Bulk Message Email Settings", null),
  bulk_messages_inapp: context(coreSchema.bulkMessagesInapp, "Bulk Message In-App Settings", null),
  bulk_messages_postal: context(coreSchema.bulkMessagesPostal, "Bulk Message Postal Settings", null),
  bulk_messages_sms: context(coreSchema.bulkMessagesSms, "Bulk Message SMS Settings", null),
  cardcheck_definitions: context(coreSchema.cardcheckDefinitions, "Card Check Definitions", "/cardcheck-definitions/{id}"),
  cardchecks: context(coreSchema.cardchecks, "Card Checks", "/cardchecks/{id}"),
  companies: context(coreSchema.companies, "Companies", "/companies/{id}"),
  contact_phone: context(coreSchema.phoneNumbers, "Phone Numbers", null),
  contact_postal: context(coreSchema.contactPostal, "Addresses", null),
  contacts: context(coreSchema.contacts, "Contacts", null),
  contract_articles: context(coreSchema.contractArticles, "Contract Articles", null),
  contract_sections: context(coreSchema.contractSections, "Contract Sections", null),
  contracts: context(coreSchema.contracts, "Contracts", "/contract/{id}"),
  dispatch_job_employer_contacts: context(coreSchema.dispatchJobEmployerContacts, "Dispatch Job Employer Contacts", null),
  dispatch_job_facility: context(coreSchema.dispatchJobFacility, "Dispatch Job Facilities", null),
  dispatch_job_fore: context(coreSchema.dispatchJobFore, "Dispatch Job Foremen", null),
  dispatch_job_group: context(coreSchema.dispatchJobGroups, "Dispatch Job Groups", "/dispatch/job_group/{id}"),
  dispatch_jobs: context(coreSchema.dispatchJobs, "Dispatch Jobs", "/dispatch/job/{id}"),
  dispatches: context(coreSchema.dispatches, "Dispatches", "/dispatch/{id}"),
  edls_assignments: context(coreSchema.edlsAssignments, "EDLS Assignments", null),
  edls_crews: context(coreSchema.edlsCrews, "EDLS Crews", null),
  edls_sheets: context(coreSchema.edlsSheets, "EDLS Sheets", "/edls/sheet/{id}"),
  employer_companies: context(coreSchema.employerCompanies, "Employer Companies", null),
  employer_contacts: context(coreSchema.employerContacts, "Employer Contacts", "/employer-contacts/{id}"),
  employer_policy_history: context(coreSchema.employerPolicyHistory, "Employer Policy History", null),
  employers: context(coreSchema.employers, "Employers", "/employers/{id}"),
  entity_files: context(coreSchema.entityFiles, "Record Attachments", null),
  entity_notes: context(coreSchema.entityNotes, "Record Notes", null),
  events: context(coreSchema.events, "Events", "/events/{id}"),
  facilities: context(coreSchema.facilities, "Facilities", "/facility/{id}"),
  files: context(coreSchema.files, "Files", null),
  grievance_complaints: context(coreSchema.grievanceComplaints, "Grievance Complaints", null),
  grievance_contracts: context(coreSchema.grievanceContracts, "Grievance Contract Citations", null),
  grievance_employers: context(coreSchema.grievanceEmployers, "Grievance Employers", null),
  grievance_remedies: context(coreSchema.grievanceRemedies, "Grievance Remedies", null),
  grievance_settlements: context(coreSchema.grievanceSettlements, "Grievance Settlements", null),
  grievance_timeline_template_steps: context(coreSchema.grievanceTimelineTemplateSteps, "Grievance Timeline Template Steps", null),
  grievance_timeline_templates: context(coreSchema.grievanceTimelineTemplates, "Grievance Timeline Templates", "/grievance-timeline-template/{id}"),
  grievance_users: context(coreSchema.grievanceUsers, "Grievance Staff", null),
  grievance_workers: context(coreSchema.grievanceWorkers, "Grievance Workers", null),
  grievances: context(coreSchema.grievances, "Grievances", "/grievance/{id}"),
  plugin_configs: context(coreSchema.pluginConfigs, "Plugin Configurations", null),
  policies: context(coreSchema.policies, "Access Policies", "/policies/{id}"),
  role_permissions: context(coreSchema.rolePermissions, "Role Permissions", null),
  roles: context(coreSchema.roles, "Roles", null),
  sftp_client_destinations: context(coreSchema.sftpClientDestinations, "SFTP Client Destinations", "/config/sftp/client/{id}"),
  sitespecific_bao_employer_immediate_eligibility: context(coreSchema.sitespecificBaoEmployerImmediateEligibility, "BAO Immediate Eligibility", null),
  sitespecific_btu_csg: context(coreSchema.sitespecificBtuCsg, "BTU Class Size Grievances", "/sitespecific/btu/csg/{id}"),
  sitespecific_btu_employer_map: context(coreSchema.sitespecificBtuEmployerMap, "BTU Employer Map", null),
  sitespecific_btu_political_officials: context(coreSchema.sitespecificBtuPoliticalOfficials, "BTU Political Officials", null),
  sitespecific_freeman_crewleads: context(coreSchema.sitespecificFreemanCrewleads, "Freeman Crew Leads", null),
  sitespecific_t631_job_interviews: context(t631InterviewSchema.sitespecificT631JobInterviews, "T631 Job Interviews", null),
  trust_benefit_eligibility_exemptions: context(coreSchema.trustBenefitEligibilityExemptions, "Benefit Eligibility Exemptions", null),
  trust_benefits: context(coreSchema.trustBenefits, "Trust Benefits", "/trust-benefits/{id}"),
  trust_provider_contacts: context(coreSchema.trustProviderContacts, "Trust Provider Contacts", "/trust-provider-contacts/{id}"),
  trust_providers: context(coreSchema.trustProviders, "Trust Providers", "/trust/provider/{id}"),
  user_roles: context(coreSchema.userRoles, "User Roles", null),
  users: context(coreSchema.users, "Users", "/users/{id}"),
  variables: context(coreSchema.variables, "Configuration Variables", null),
  wizard_employment_status_mappings: context(coreSchema.wizardEmploymentStatusMappings, "Wizard Employment Status Mappings", null),
  wizard_feed_mappings: context(coreSchema.wizardFeedMappings, "Wizard Feed Mappings", null),
  wizards: context(coreSchema.wizards, "Wizards", "/wizards/{id}"),
  worker_bans: context(coreSchema.workerBans, "Worker Bans", null),
  worker_certifications: context(coreSchema.workerCertifications, "Worker Certifications", null),
  worker_edls: context(coreSchema.workerEdls, "Worker EDLS Settings", null),
  worker_hours: context(coreSchema.workerHours, "Worker Hours", "/hours/{id}"),
  worker_ids: context(coreSchema.workerIds, "Worker Identifiers", null),
  worker_ratings: context(coreSchema.workerRatings, "Worker Ratings", null),
  worker_relations: context(coreSchema.workerRelations, "Worker Relations", null),
  worker_skills: context(coreSchema.workerSkills, "Worker Skills", null),
  worker_steward_assignments: context(coreSchema.workerStewardAssignments, "Worker Steward Assignments", null),
  worker_tos: context(coreSchema.workerTos, "Worker Terms Acceptance", null),
  worker_trust_elections: context(coreSchema.workerTrustElections, "Trust Elections", "/trust/election/{id}"),
  workers: context(coreSchema.workers, "Workers", "/workers/{id}"),
  ws_client_credentials: context(coreSchema.wsClientCredentials, "Web Service Credentials", null),
  ws_client_grants: context(coreSchema.wsClientGrants, "Web Service Access Grants", null),
  ws_client_ip_rules: context(coreSchema.wsClientIpRules, "Web Service IP Rules", null),
  ws_clients: context(coreSchema.wsClients, "Web Service Clients", "/admin/ws/clients/{id}"),
};

export interface MetadataRecordContextInfo extends MetadataRecordContext {
  contextId: string;
  tableName: string;
}

function contextInfo(contextId: string, declaration: MetadataRecordContext): MetadataRecordContextInfo {
  return { contextId, ...declaration, tableName: getTableName(declaration.table) };
}

/** Resolve a stored context id to its declared physical table. */
export function getMetadataRecordContext(contextId: string): MetadataRecordContextInfo | undefined {
  const declaration = entityMetadataContexts[contextId];
  if (!declaration || !isMetadataTableEligible(getTableName(declaration.table))) return undefined;
  return contextInfo(contextId, declaration);
}

/** Resolve a logging config's physical table to its unambiguous context id. */
export function getMetadataContextForTable(tableName: string): MetadataRecordContextInfo | undefined {
  if (!isMetadataTableEligible(tableName)) return undefined;
  const matches = Object.entries(entityMetadataContexts)
    .filter(([, declaration]) => getTableName(declaration.table) === tableName)
    .map(([contextId, declaration]) => contextInfo(contextId, declaration));
  return matches.length === 1 ? matches[0] : undefined;
}

export function isMetadataRecordContext(contextId: string): boolean {
  return getMetadataRecordContext(contextId) !== undefined;
}

export function metadataRecordHref(contextId: string, entityId: string): string | null {
  const template = getMetadataRecordContext(contextId)?.hrefTemplate;
  return template ? template.replace("{id}", encodeURIComponent(entityId)) : null;
}

export function listMetadataRecordContexts(): MetadataRecordContextInfo[] {
  return Object.keys(entityMetadataContexts)
    .map((contextId) => getMetadataRecordContext(contextId))
    .filter((entry): entry is MetadataRecordContextInfo => entry !== undefined)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Startup validation keeps logging declarations and the context registry
 * complete. Excluded process tables are intentionally not required contexts.
 */
export function assertEntityMetadataRecordTablesComplete(): void {
  const problems: string[] = [];
  const tableOwners = new Map<string, string[]>();

  for (const [contextId, declaration] of Object.entries(entityMetadataContexts)) {
    const tableName = getTableName(declaration.table);
    const owners = tableOwners.get(tableName) ?? [];
    owners.push(contextId);
    tableOwners.set(tableName, owners);
    if (!isMetadataTableEligible(tableName)) {
      problems.push(`context "${contextId}" claims excluded table "${tableName}"`);
    }
  }

  for (const [tableName, owners] of tableOwners) {
    if (owners.length > 1) {
      problems.push(`table "${tableName}" is claimed by multiple contexts: ${owners.join(", ")}`);
    }
  }

  const undeclared = getLoggedTableNames().filter(
    (name) => isMetadataTableEligible(name) && !getMetadataContextForTable(name),
  );
  if (undeclared.length > 0) {
    problems.push(`named by a storage logging config but not declared: ${undeclared.join(", ")}`);
  }

  if (problems.length === 0) return;

  const runtimeNamed = getModulesNamingTablesAtRuntime();
  const caveat =
    runtimeNamed.length > 0
      ? ` (these modules name their table at call time and cannot be enumerated, so their tables must be declared by hand: ${runtimeNamed.join(", ")})`
      : "";
  throw new Error(
    `server/storage/entity-metadata-record-tables.ts is out of step — ${problems.join("; ")}${caveat}`,
  );
}
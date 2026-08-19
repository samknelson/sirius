/**
 * Approved production-owned baseline for the S1 migration target.
 *
 * Keep this file semantic: component ids, account names, policy codes, and
 * employment-status names/codes are resolved on the target. It must never
 * contain source-database row ids, copied JSON blobs, or credentials.
 */
export const PRODUCTION_COMPONENT_IDS = [
  "bulk",
  "cardcheck",
  "employer.company",
  "ledger",
  "ledger.payment.batch",
  "sitespecific.bao",
  "system.sftp.client",
  "trust.benefits",
  "trust.benefits.scan",
  "trust.elections",
  "trust.providers",
  "trust.providers.edi",
  "worker.relations",
] as const;

export const FORBIDDEN_PRODUCTION_COMPONENT_IDS = [
  "debug",
  "facility",
  "ledger.dummy_gateway",
  "sitespecific.bao.s1migration",
] as const;

export const CONTRIBUTION_ACCOUNT_SPECS = [
  {
    name: "Employee Contributions",
    description: "Employee contribution ledger account",
  },
  {
    name: "Employer Contributions",
    description: "Employer contribution ledger account",
  },
] as const;

export const BAO_HOURLY_CONFIG = {
  pluginKind: "charge",
  pluginId: "bao-hourly",
  name: "BAO Hourly",
  siriusId: "s1-migration.bao-hourly",
  scope: "global",
  accountName: "Employer Contributions",
} as const;

export const EMPLOYMENT_STATUS_SPECS = [
  { name: "Active", code: "ACTIVE", billed: true, explicitlyNonBilled: false },
  { name: "Initial Eligibility", code: "INITELIG", billed: false, explicitlyNonBilled: true },
  { name: "No Charge", code: "NOCHARGE", billed: false, explicitlyNonBilled: true },
  { name: "Event Center Hours Purchasing", code: "ECHP", billed: false, explicitlyNonBilled: true },
  { name: "Disability", code: "DISABILITY", billed: false, explicitlyNonBilled: false },
  { name: "FMLA", code: "FMLA", billed: true, explicitlyNonBilled: false },
  { name: "LOA", code: "LOA", billed: true, explicitlyNonBilled: false },
  { name: "Military Leave", code: "MILITARY", billed: true, explicitlyNonBilled: false },
  { name: "COBRA", code: "COBRA", billed: false, explicitlyNonBilled: true },
  { name: "Terminated", code: "TERM", billed: true, explicitlyNonBilled: false },
  { name: "Deceased", code: "DECEASED", billed: true, explicitlyNonBilled: false },
] as const;

export const POLICY_SIRIUS_IDS = ["EC", "UH"] as const;

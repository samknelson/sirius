/**
 * Shared Tab Registry
 * 
 * Centralized tab definitions with access policy metadata for dynamic tab visibility.
 * Used by both frontend (to filter visible tabs) and backend (to batch-check access).
 */

/**
 * Tab definition with access requirements
 */
export interface TabDefinition {
  id: string;
  label: string;
  hrefTemplate: string;
  policyId?: string;
  permission?: string;
  component?: string;
  parent?: string;
}

/**
 * Entity type for tab registry
 */
export type TabEntityType = 'worker' | 'employer' | 'employer_contact' | 'provider' | 'provider_contact' | 'policy' | 'event';

/**
 * Tab check request for batch access evaluation
 */
export interface TabAccessCheckRequest {
  entityType: TabEntityType;
  entityId: string;
}

/**
 * Tab access result from batch evaluation
 */
export interface TabAccessResult {
  tabId: string;
  granted: boolean;
  reason?: string;
}

/**
 * Worker entity tabs
 * 
 * Policy Notes:
 * - 'worker' policy: Grants access to staff OR worker viewing their own record (default for most tabs)
 * - 'worker.self' policy: Specifically for tabs where worker self-access is the primary use case
 * - permission-based: Staff-only tabs that workers cannot access even for their own record
 */
export const workerTabs: TabDefinition[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/workers/{id}', policyId: 'worker' },
  { id: 'identity', label: 'Identity', hrefTemplate: '/workers/{id}/name', policyId: 'worker' },
  { id: 'contact', label: 'Contact', hrefTemplate: '/workers/{id}/email', policyId: 'worker' },
  { id: 'comm', label: 'Comm', hrefTemplate: '/workers/{id}/comm/history', policyId: 'worker' },
  { id: 'employment', label: 'Employment', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker' },
  { id: 'benefits', label: 'Benefits', hrefTemplate: '/workers/{id}/benefits/history', policyId: 'worker' },
  { id: 'union', label: 'Union', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker', component: 'cardcheck|bargainingunits|worker.steward' },
  { id: 'dispatch', label: 'Dispatch', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker', component: 'dispatch' },
  { id: 'accounting', label: 'Accounting', hrefTemplate: '/workers/{id}/ledger/accounts', permission: 'ledger.view', component: 'ledger' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/workers/{id}/logs', permission: 'workers.view' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/workers/{id}/delete', permission: 'workers.delete' },
];

export const workerIdentitySubTabs: TabDefinition[] = [
  { id: 'name', label: 'Name', hrefTemplate: '/workers/{id}/name', policyId: 'worker', parent: 'identity' },
  { id: 'ids', label: 'IDs', hrefTemplate: '/workers/{id}/ids', permission: 'workers.view', parent: 'identity' },
  { id: 'birth-date', label: 'Birth Date', hrefTemplate: '/workers/{id}/birth-date', policyId: 'worker', parent: 'identity' },
  { id: 'gender', label: 'Gender', hrefTemplate: '/workers/{id}/gender', policyId: 'worker', parent: 'identity' },
  { id: 'work-status', label: 'Work Status', hrefTemplate: '/workers/{id}/work-status', policyId: 'worker', parent: 'identity' },
  { id: 'user', label: 'User', hrefTemplate: '/workers/{id}/user', permission: 'workers.view', parent: 'identity' },
  { id: 'bans', label: 'Bans', hrefTemplate: '/workers/{id}/bans', policyId: 'worker', component: 'dispatch', parent: 'identity' },
];

export const workerContactSubTabs: TabDefinition[] = [
  { id: 'email', label: 'Email', hrefTemplate: '/workers/{id}/email', policyId: 'worker', parent: 'contact' },
  { id: 'addresses', label: 'Addresses', hrefTemplate: '/workers/{id}/addresses', policyId: 'worker', parent: 'contact' },
  { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/workers/{id}/phone-numbers', policyId: 'worker', parent: 'contact' },
];

export const workerCommSubTabs: TabDefinition[] = [
  { id: 'comm-history', label: 'History', hrefTemplate: '/workers/{id}/comm/history', policyId: 'worker', parent: 'comm' },
  { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/workers/{id}/comm/send-sms', permission: 'workers.comm', parent: 'comm' },
  { id: 'send-email', label: 'Send Email', hrefTemplate: '/workers/{id}/comm/send-email', permission: 'workers.comm', parent: 'comm' },
  { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/workers/{id}/comm/send-postal', permission: 'workers.comm', parent: 'comm' },
  { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/workers/{id}/comm/send-inapp', permission: 'workers.comm', parent: 'comm' },
];

export const workerEmploymentSubTabs: TabDefinition[] = [
  { id: 'current', label: 'Current', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker', parent: 'employment' },
  { id: 'history', label: 'History', hrefTemplate: '/workers/{id}/employment/history', policyId: 'worker', parent: 'employment' },
  { id: 'monthly', label: 'Monthly', hrefTemplate: '/workers/{id}/employment/monthly', policyId: 'worker', parent: 'employment' },
  { id: 'daily', label: 'Daily', hrefTemplate: '/workers/{id}/employment/daily', policyId: 'worker', parent: 'employment' },
];

export const workerBenefitsSubTabs: TabDefinition[] = [
  { id: 'benefits-history', label: 'History', hrefTemplate: '/workers/{id}/benefits/history', policyId: 'worker', parent: 'benefits' },
  { id: 'benefits-eligibility', label: 'Eligibility', hrefTemplate: '/workers/{id}/benefits/eligibility', policyId: 'worker', parent: 'benefits' },
  { id: 'benefits-scan', label: 'Scan', hrefTemplate: '/workers/{id}/benefits/scan', permission: 'workers.view', parent: 'benefits' },
];

export const workerUnionSubTabs: TabDefinition[] = [
  { id: 'cardchecks', label: 'Cardchecks', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker', component: 'cardcheck', parent: 'union' },
  { id: 'bargaining-unit', label: 'Bargaining Unit', hrefTemplate: '/workers/{id}/union/bargaining-unit', policyId: 'worker', component: 'bargainingunits', parent: 'union' },
  { id: 'steward', label: 'Steward', hrefTemplate: '/workers/{id}/union/steward', policyId: 'worker', component: 'worker.steward', parent: 'union' },
  { id: 'representatives', label: 'Representatives', hrefTemplate: '/workers/{id}/union/representatives', policyId: 'worker', component: 'worker.steward', parent: 'union' },
];

export const workerDispatchSubTabs: TabDefinition[] = [
  { id: 'dispatch-status', label: 'Status', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker', component: 'dispatch', parent: 'dispatch' },
  { id: 'dispatch-dnc', label: 'Do Not Call', hrefTemplate: '/workers/{id}/dispatch/do-not-call', policyId: 'worker', component: 'dispatch.dnc', parent: 'dispatch' },
  { id: 'dispatch-hfe', label: 'Hold for Employer', hrefTemplate: '/workers/{id}/dispatch/hold-for-employer', policyId: 'worker', component: 'dispatch.hfe', parent: 'dispatch' },
];

/**
 * All worker tabs combined for batch access checking
 */
export const allWorkerTabs: TabDefinition[] = [
  ...workerTabs,
  ...workerIdentitySubTabs,
  ...workerContactSubTabs,
  ...workerCommSubTabs,
  ...workerEmploymentSubTabs,
  ...workerBenefitsSubTabs,
  ...workerUnionSubTabs,
  ...workerDispatchSubTabs,
];

/**
 * Employer entity tabs
 */
export const employerTabs: TabDefinition[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/employers/{id}', permission: 'employers.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/employers/{id}/edit', permission: 'employers.edit' },
  { id: 'workers', label: 'Workers', hrefTemplate: '/employers/{id}/workers', permission: 'employers.view' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/employers/{id}/contacts', permission: 'employers.view' },
  { id: 'policy-history', label: 'Policy History', hrefTemplate: '/employers/{id}/policy-history', permission: 'employers.view' },
  { id: 'wizards', label: 'Wizards', hrefTemplate: '/employers/{id}/wizards', permission: 'employers.view' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/employers/{id}/logs', permission: 'employers.view' },
  { id: 'accounting', label: 'Accounting', hrefTemplate: '/employers/{id}/ledger/accounts', permission: 'ledger.staff|ledger.employer', component: 'ledger' },
  { id: 'union', label: 'Union', hrefTemplate: '/employers/{id}/union/stewards', permission: 'employers.view', component: 'worker.steward' },
  { id: 'dispatch', label: 'Dispatch', hrefTemplate: '/employers/{id}/dispatch', permission: 'employers.view', component: 'dispatch' },
];

export const employerAccountingSubTabs: TabDefinition[] = [
  { id: 'accounts', label: 'Accounts', hrefTemplate: '/employers/{id}/ledger/accounts', permission: 'ledger.staff|ledger.employer', parent: 'accounting' },
  { id: 'payment-methods', label: 'Payment Methods', hrefTemplate: '/employers/{id}/ledger/stripe/payment_methods', permission: 'ledger.staff|ledger.employer', parent: 'accounting' },
  { id: 'customer', label: 'Customer', hrefTemplate: '/employers/{id}/ledger/stripe/customer', permission: 'ledger.staff|ledger.employer', parent: 'accounting' },
];

export const employerUnionSubTabs: TabDefinition[] = [
  { id: 'stewards', label: 'Stewards', hrefTemplate: '/employers/{id}/union/stewards', permission: 'employers.view', component: 'worker.steward', parent: 'union' },
];

export const allEmployerTabs: TabDefinition[] = [
  ...employerTabs,
  ...employerAccountingSubTabs,
  ...employerUnionSubTabs,
];

/**
 * Provider entity tabs
 */
export const providerTabs: TabDefinition[] = [
  { id: 'view', label: 'View', hrefTemplate: '/trust/provider/{id}', permission: 'trust.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust/provider/{id}/edit', permission: 'trust.edit' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/trust/provider/{id}/contacts', permission: 'trust.view' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/trust/provider/{id}/logs', permission: 'trust.view' },
];

export const allProviderTabs: TabDefinition[] = [
  ...providerTabs,
];

/**
 * Tab registry by entity type
 */
export const tabRegistry: Record<TabEntityType, TabDefinition[]> = {
  worker: allWorkerTabs,
  employer: allEmployerTabs,
  employer_contact: [],
  provider: allProviderTabs,
  provider_contact: [],
  policy: [],
  event: [],
};

/**
 * Get all tabs for an entity type
 */
export function getTabsForEntity(entityType: TabEntityType): TabDefinition[] {
  return tabRegistry[entityType] || [];
}

/**
 * Build href from template and entity ID
 */
export function buildTabHref(template: string, entityId: string): string {
  return template.replace('{id}', entityId);
}

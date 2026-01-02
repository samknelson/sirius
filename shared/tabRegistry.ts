/**
 * Shared Tab Registry
 * 
 * Centralized hierarchical tab definitions with access policy metadata.
 * Used by both frontend (to filter and render visible tabs) and backend (to batch-check access).
 * 
 * The tree structure allows layouts to render tabs by iterating over the hierarchy
 * without hardcoded conditionals about which sub-tabs to show.
 */

/**
 * Base tab definition with access requirements
 */
export interface TabDefinition {
  id: string;
  label: string;
  hrefTemplate: string;
  policyId?: string;
  permission?: string;
  component?: string;
  parent?: string;
  /** Terminology key for dynamic label substitution (e.g., 'steward', 'union') */
  termKey?: string;
  /** Whether to use plural form for terminology substitution */
  termPlural?: boolean;
}

/**
 * Hierarchical tab definition with optional children
 */
export interface HierarchicalTab extends TabDefinition {
  children?: HierarchicalTab[];
}

/**
 * Flattened tab for batch access checking (includes parent reference)
 */
export interface FlatTab extends TabDefinition {
  parent?: string;
}

/**
 * Entity type for tab registry
 */
export type TabEntityType = 
  | 'worker' 
  | 'employer' 
  | 'employer_contact' 
  | 'provider' 
  | 'provider_contact' 
  | 'policy' 
  | 'event'
  | 'bargaining_unit'
  | 'btu_csg'
  | 'cron_job'
  | 'dispatch_job'
  | 'dispatch_job_type'
  | 'ledger_account'
  | 'ledger_payment'
  | 'trust_benefit'
  | 'worker_hours'
  | 'user';

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
 * Worker entity tab tree
 * 
 * Policy Notes:
 * - 'worker' policy: Grants access to staff OR worker viewing their own record (default for most tabs)
 * - 'worker.self' policy: Specifically for tabs where worker self-access is the primary use case
 * - permission-based: Staff-only tabs that workers cannot access even for their own record
 */
export const workerTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/workers/{id}', policyId: 'worker' },
  { 
    id: 'identity', label: 'Identity', hrefTemplate: '/workers/{id}/name', policyId: 'worker',
    children: [
      { id: 'name', label: 'Name', hrefTemplate: '/workers/{id}/name', policyId: 'worker' },
      { id: 'ids', label: 'IDs', hrefTemplate: '/workers/{id}/ids', permission: 'workers.view' },
      { id: 'birth-date', label: 'Birth Date', hrefTemplate: '/workers/{id}/birth-date', policyId: 'worker' },
      { id: 'gender', label: 'Gender', hrefTemplate: '/workers/{id}/gender', policyId: 'worker' },
      { id: 'work-status', label: 'Work Status', hrefTemplate: '/workers/{id}/work-status', policyId: 'worker' },
      { id: 'user', label: 'User', hrefTemplate: '/workers/{id}/user', permission: 'workers.view' },
      { id: 'bans', label: 'Bans', hrefTemplate: '/workers/{id}/bans', policyId: 'worker', component: 'dispatch' },
    ]
  },
  { 
    id: 'contact', label: 'Contact', hrefTemplate: '/workers/{id}/email', policyId: 'worker',
    children: [
      { id: 'email', label: 'Email', hrefTemplate: '/workers/{id}/email', policyId: 'worker' },
      { id: 'addresses', label: 'Addresses', hrefTemplate: '/workers/{id}/addresses', policyId: 'worker' },
      { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/workers/{id}/phone-numbers', policyId: 'worker' },
    ]
  },
  { 
    id: 'comm', label: 'Comm', hrefTemplate: '/workers/{id}/comm/history', policyId: 'worker',
    children: [
      { id: 'comm-history', label: 'History', hrefTemplate: '/workers/{id}/comm/history', policyId: 'worker' },
      { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/workers/{id}/comm/send-sms', permission: 'workers.comm' },
      { id: 'send-email', label: 'Send Email', hrefTemplate: '/workers/{id}/comm/send-email', permission: 'workers.comm' },
      { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/workers/{id}/comm/send-postal', permission: 'workers.comm' },
      { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/workers/{id}/comm/send-inapp', permission: 'workers.comm' },
    ]
  },
  { 
    id: 'employment', label: 'Employment', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker',
    children: [
      { id: 'current', label: 'Current', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker' },
      { id: 'history', label: 'History', hrefTemplate: '/workers/{id}/employment/history', policyId: 'worker' },
      { id: 'monthly', label: 'Monthly', hrefTemplate: '/workers/{id}/employment/monthly', policyId: 'worker' },
      { id: 'daily', label: 'Daily', hrefTemplate: '/workers/{id}/employment/daily', policyId: 'worker' },
    ]
  },
  { 
    id: 'benefits', label: 'Benefits', hrefTemplate: '/workers/{id}/benefits/history', policyId: 'worker',
    children: [
      { id: 'benefits-history', label: 'History', hrefTemplate: '/workers/{id}/benefits/history', policyId: 'worker' },
      { id: 'benefits-eligibility', label: 'Eligibility', hrefTemplate: '/workers/{id}/benefits/eligibility', policyId: 'worker' },
      { id: 'benefits-scan', label: 'Scan', hrefTemplate: '/workers/{id}/benefits/scan', permission: 'workers.view' },
    ]
  },
  { 
    id: 'union', label: 'Union', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker', component: 'cardcheck|bargainingunits|worker.steward', termKey: 'union',
    children: [
      { id: 'cardchecks', label: 'Cardchecks', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker', component: 'cardcheck' },
      { id: 'bargaining-unit', label: 'Bargaining Unit', hrefTemplate: '/workers/{id}/union/bargaining-unit', policyId: 'worker', component: 'bargainingunits' },
      { id: 'steward', label: 'Steward', hrefTemplate: '/workers/{id}/union/steward', policyId: 'worker', component: 'worker.steward', termKey: 'steward' },
      { id: 'representatives', label: 'Representatives', hrefTemplate: '/workers/{id}/union/representatives', policyId: 'worker', component: 'worker.steward' },
    ]
  },
  { 
    id: 'dispatch', label: 'Dispatch', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker', component: 'dispatch',
    children: [
      { id: 'dispatch-status', label: 'Status', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker', component: 'dispatch' },
      { id: 'dispatch-dnc', label: 'Do Not Call', hrefTemplate: '/workers/{id}/dispatch/do-not-call', policyId: 'worker', component: 'dispatch.dnc' },
      { id: 'dispatch-hfe', label: 'Hold for Employer', hrefTemplate: '/workers/{id}/dispatch/hold-for-employer', policyId: 'worker', component: 'dispatch.hfe' },
    ]
  },
  { id: 'accounting', label: 'Accounting', hrefTemplate: '/workers/{id}/ledger/accounts', permission: 'ledger.view', component: 'ledger' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/workers/{id}/logs', permission: 'workers.view' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/workers/{id}/delete', permission: 'workers.delete' },
];

/**
 * Employer entity tab tree
 */
export const employerTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/employers/{id}', permission: 'employers.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/employers/{id}/edit', permission: 'employers.edit' },
  { id: 'workers', label: 'Workers', hrefTemplate: '/employers/{id}/workers', permission: 'employers.view' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/employers/{id}/contacts', permission: 'employers.view' },
  { id: 'policy-history', label: 'Policy History', hrefTemplate: '/employers/{id}/policy-history', permission: 'employers.view' },
  { id: 'wizards', label: 'Wizards', hrefTemplate: '/employers/{id}/wizards', permission: 'employers.view' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/employers/{id}/logs', permission: 'employers.view' },
  { 
    id: 'accounting', label: 'Accounting', hrefTemplate: '/employers/{id}/ledger/accounts', permission: 'ledger.staff|ledger.employer', component: 'ledger',
    children: [
      { id: 'accounts', label: 'Accounts', hrefTemplate: '/employers/{id}/ledger/accounts', permission: 'ledger.staff|ledger.employer' },
      { id: 'payment-methods', label: 'Payment Methods', hrefTemplate: '/employers/{id}/ledger/stripe/payment_methods', permission: 'ledger.staff|ledger.employer' },
      { id: 'customer', label: 'Customer', hrefTemplate: '/employers/{id}/ledger/stripe/customer', permission: 'ledger.staff|ledger.employer' },
    ]
  },
  { 
    id: 'union', label: 'Union', hrefTemplate: '/employers/{id}/union/stewards', permission: 'employers.view', component: 'worker.steward', termKey: 'union',
    children: [
      { id: 'stewards', label: 'Stewards', hrefTemplate: '/employers/{id}/union/stewards', permission: 'employers.view', component: 'worker.steward', termKey: 'steward', termPlural: true },
    ]
  },
  { id: 'dispatch', label: 'Dispatch', hrefTemplate: '/employers/{id}/dispatch', permission: 'employers.view', component: 'dispatch' },
];

/**
 * Provider entity tab tree
 */
export const providerTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/trust/provider/{id}', permission: 'trust.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust/provider/{id}/edit', permission: 'trust.edit' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/trust/provider/{id}/contacts', permission: 'trust.view' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/trust/provider/{id}/logs', permission: 'trust.view' },
];

/**
 * Policy entity tab tree
 */
export const policyTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/policies/{id}', permission: 'policies.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/policies/{id}/edit', permission: 'policies.edit' },
  { id: 'benefits', label: 'Benefits', hrefTemplate: '/policies/{id}/benefits', permission: 'policies.view' },
];

/**
 * Event entity tab tree
 */
export const eventTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/events/{id}', permission: 'events.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/events/{id}/edit', permission: 'events.edit' },
  { id: 'register', label: 'Register', hrefTemplate: '/events/{id}/register', permission: 'events.edit' },
  { id: 'roster', label: 'Roster', hrefTemplate: '/events/{id}/roster', permission: 'events.view' },
  { id: 'self-register', label: 'Self-Register', hrefTemplate: '/events/{id}/self-register', permission: 'events.view' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/events/{id}/delete', permission: 'events.delete' },
];

/**
 * Bargaining unit entity tab tree
 */
export const bargainingUnitTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/bargaining-units/{id}', permission: 'bargainingunits.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/bargaining-units/{id}/edit', permission: 'bargainingunits.edit' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/bargaining-units/{id}/delete', permission: 'bargainingunits.delete' },
];

/**
 * BTU CSG (Class Size Grievance) entity tab tree
 */
export const btuCsgTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/sitespecific/btu/csg/{id}', permission: 'sitespecific.btu.csg.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/sitespecific/btu/csg/{id}/edit', permission: 'sitespecific.btu.csg.edit' },
];

/**
 * Cron job entity tab tree (uses job name as identifier, not id)
 */
export const cronJobTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/cron-jobs/{id}/view', permission: 'cron.view' },
  { id: 'settings', label: 'Settings', hrefTemplate: '/cron-jobs/{id}/settings', permission: 'cron.edit' },
  { id: 'history', label: 'History', hrefTemplate: '/cron-jobs/{id}/history', permission: 'cron.view' },
];

/**
 * Dispatch job entity tab tree
 */
export const dispatchJobTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/dispatch/job/{id}', permission: 'dispatch.view', component: 'dispatch' },
  { id: 'dispatches', label: 'Dispatches', hrefTemplate: '/dispatch/job/{id}/dispatches', permission: 'dispatch.view', component: 'dispatch' },
  { id: 'eligible-workers', label: 'Eligible Workers', hrefTemplate: '/dispatch/job/{id}/eligible-workers', permission: 'dispatch.view', component: 'dispatch' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/dispatch/job/{id}/edit', permission: 'dispatch.edit', component: 'dispatch' },
];

/**
 * Dispatch job type entity tab tree
 */
export const dispatchJobTypeTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/config/dispatch-job-type/{id}', permission: 'dispatch.view', component: 'dispatch' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/config/dispatch-job-type/{id}/edit', permission: 'dispatch.edit', component: 'dispatch' },
  { id: 'plugins', label: 'Plugins', hrefTemplate: '/config/dispatch-job-type/{id}/plugins', permission: 'dispatch.edit', component: 'dispatch' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/config/dispatch-job-type/{id}/delete', permission: 'dispatch.delete', component: 'dispatch' },
];

/**
 * Ledger account entity tab tree
 */
export const ledgerAccountTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/ledger/account/{id}', permission: 'ledger.view', component: 'ledger' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/ledger/account/{id}/edit', permission: 'ledger.edit', component: 'ledger' },
  { id: 'payments', label: 'Payments', hrefTemplate: '/ledger/account/{id}/payments', permission: 'ledger.view', component: 'ledger' },
  { id: 'transactions', label: 'Transactions', hrefTemplate: '/ledger/account/{id}/transactions', permission: 'ledger.view', component: 'ledger' },
  { id: 'participants', label: 'Participants', hrefTemplate: '/ledger/account/{id}/participants', permission: 'ledger.view', component: 'ledger' },
  { id: 'settings', label: 'Settings', hrefTemplate: '/ledger/account/{id}/settings', permission: 'ledger.edit', component: 'ledger' },
];

/**
 * Ledger payment entity tab tree
 */
export const ledgerPaymentTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/ledger/payment/{id}', permission: 'ledger.view', component: 'ledger' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/ledger/payment/{id}/edit', permission: 'ledger.edit', component: 'ledger' },
];

/**
 * Trust benefit entity tab tree
 */
export const trustBenefitTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/trust-benefits/{id}', permission: 'trust.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust-benefits/{id}/edit', permission: 'trust.edit' },
];

/**
 * Worker hours entry tab tree
 */
export const workerHoursTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/worker-hours/{id}', permission: 'workers.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/worker-hours/{id}/edit', permission: 'workers.edit' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/worker-hours/{id}/delete', permission: 'workers.delete' },
];

/**
 * Employer contact entity tab tree
 */
export const employerContactTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/employer-contacts/{id}', permission: 'employers.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/employer-contacts/{id}/edit', permission: 'employers.edit' },
  { id: 'name', label: 'Name', hrefTemplate: '/employer-contacts/{id}/name', permission: 'employers.edit' },
  { id: 'email', label: 'Email', hrefTemplate: '/employer-contacts/{id}/email', permission: 'employers.edit' },
  { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/employer-contacts/{id}/phone-numbers', permission: 'employers.edit' },
  { id: 'addresses', label: 'Addresses', hrefTemplate: '/employer-contacts/{id}/addresses', permission: 'employers.edit' },
  { 
    id: 'comm', 
    label: 'Comm', 
    hrefTemplate: '/employer-contacts/{id}/comm/history', 
    permission: 'communication.view',
    children: [
      { id: 'comm-history', label: 'History', hrefTemplate: '/employer-contacts/{id}/comm/history', permission: 'communication.view' },
      { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/employer-contacts/{id}/comm/send-sms', permission: 'communication.send' },
      { id: 'send-email', label: 'Send Email', hrefTemplate: '/employer-contacts/{id}/comm/send-email', permission: 'communication.send' },
      { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/employer-contacts/{id}/comm/send-postal', permission: 'communication.send' },
      { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/employer-contacts/{id}/comm/send-inapp', permission: 'communication.send' },
    ],
  },
  { id: 'user', label: 'User', hrefTemplate: '/employer-contacts/{id}/user', permission: 'users.view' },
];

/**
 * Trust provider contact entity tab tree
 */
export const providerContactTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/trust-provider-contacts/{id}', permission: 'providers.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust-provider-contacts/{id}/edit', permission: 'providers.edit' },
  { id: 'name', label: 'Name', hrefTemplate: '/trust-provider-contacts/{id}/name', permission: 'providers.edit' },
  { id: 'email', label: 'Email', hrefTemplate: '/trust-provider-contacts/{id}/email', permission: 'providers.edit' },
  { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/trust-provider-contacts/{id}/phone-numbers', permission: 'providers.edit' },
  { id: 'addresses', label: 'Addresses', hrefTemplate: '/trust-provider-contacts/{id}/addresses', permission: 'providers.edit' },
  { 
    id: 'comm', 
    label: 'Comm', 
    hrefTemplate: '/trust-provider-contacts/{id}/comm/history', 
    permission: 'communication.view',
    children: [
      { id: 'comm-history', label: 'History', hrefTemplate: '/trust-provider-contacts/{id}/comm/history', permission: 'communication.view' },
      { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/trust-provider-contacts/{id}/comm/send-sms', permission: 'communication.send' },
      { id: 'send-email', label: 'Send Email', hrefTemplate: '/trust-provider-contacts/{id}/comm/send-email', permission: 'communication.send' },
      { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/trust-provider-contacts/{id}/comm/send-postal', permission: 'communication.send' },
      { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/trust-provider-contacts/{id}/comm/send-inapp', permission: 'communication.send' },
    ],
  },
  { id: 'user', label: 'User', hrefTemplate: '/trust-provider-contacts/{id}/user', permission: 'users.view' },
];

/**
 * User entity tab tree
 */
export const userTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/users/{id}', permission: 'users.view' },
  { 
    id: 'contact', 
    label: 'Contact', 
    hrefTemplate: '/users/{id}/contact/email', 
    permission: 'users.view',
    children: [
      { id: 'email', label: 'Email', hrefTemplate: '/users/{id}/contact/email', permission: 'users.view' },
      { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/users/{id}/contact/phone-numbers', permission: 'users.view' },
      { id: 'addresses', label: 'Addresses', hrefTemplate: '/users/{id}/contact/addresses', permission: 'users.view' },
    ],
  },
  { 
    id: 'comm', 
    label: 'Comm', 
    hrefTemplate: '/users/{id}/comm/history', 
    permission: 'communication.view',
    children: [
      { id: 'comm-history', label: 'History', hrefTemplate: '/users/{id}/comm/history', permission: 'communication.view' },
      { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/users/{id}/comm/send-sms', permission: 'communication.send' },
      { id: 'send-email', label: 'Send Email', hrefTemplate: '/users/{id}/comm/send-email', permission: 'communication.send' },
      { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/users/{id}/comm/send-postal', permission: 'communication.send' },
      { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/users/{id}/comm/send-inapp', permission: 'communication.send' },
    ],
  },
  { id: 'logs', label: 'Logs', hrefTemplate: '/users/{id}/logs', permission: 'users.view' },
];

/**
 * Entity tab trees by type
 */
export const tabTreeRegistry: Record<TabEntityType, HierarchicalTab[]> = {
  worker: workerTabTree,
  employer: employerTabTree,
  employer_contact: employerContactTabTree,
  provider: providerTabTree,
  provider_contact: providerContactTabTree,
  policy: policyTabTree,
  event: eventTabTree,
  bargaining_unit: bargainingUnitTabTree,
  btu_csg: btuCsgTabTree,
  cron_job: cronJobTabTree,
  dispatch_job: dispatchJobTabTree,
  dispatch_job_type: dispatchJobTypeTabTree,
  ledger_account: ledgerAccountTabTree,
  ledger_payment: ledgerPaymentTabTree,
  trust_benefit: trustBenefitTabTree,
  worker_hours: workerHoursTabTree,
  user: userTabTree,
};

/**
 * Flatten a hierarchical tab tree into a flat array with parent references
 * Used for batch access checking on the backend
 */
export function flattenTabTree(tree: HierarchicalTab[], parentId?: string): FlatTab[] {
  const result: FlatTab[] = [];
  
  for (const tab of tree) {
    const { children, ...tabWithoutChildren } = tab;
    result.push({
      ...tabWithoutChildren,
      parent: parentId,
    });
    
    if (children && children.length > 0) {
      result.push(...flattenTabTree(children, tab.id));
    }
  }
  
  return result;
}

/**
 * Get flattened tabs for an entity type (for backend batch checking)
 */
export function getTabsForEntity(entityType: TabEntityType): FlatTab[] {
  const tree = tabTreeRegistry[entityType] || [];
  return flattenTabTree(tree);
}

/**
 * Get the hierarchical tab tree for an entity type
 */
export function getTabTreeForEntity(entityType: TabEntityType): HierarchicalTab[] {
  return tabTreeRegistry[entityType] || [];
}

/**
 * Build href from template and entity ID
 */
export function buildTabHref(template: string, entityId: string): string {
  return template.replace('{id}', entityId);
}

/**
 * Find a tab's root parent in the tree
 */
export function findRootParent(tabId: string, tree: HierarchicalTab[]): HierarchicalTab | undefined {
  for (const tab of tree) {
    if (tab.id === tabId) {
      return tab;
    }
    if (tab.children) {
      const foundInChildren = tab.children.find(child => child.id === tabId);
      if (foundInChildren) {
        return tab;
      }
    }
  }
  return undefined;
}

/**
 * Find a tab by ID in the tree (searches recursively)
 */
export function findTabById(tabId: string, tree: HierarchicalTab[]): HierarchicalTab | undefined {
  for (const tab of tree) {
    if (tab.id === tabId) {
      return tab;
    }
    if (tab.children) {
      const found = findTabById(tabId, tab.children);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Check if a tab ID is a child of another tab
 */
export function isChildOf(childId: string, parentId: string, tree: HierarchicalTab[]): boolean {
  const parent = findTabById(parentId, tree);
  if (!parent || !parent.children) return false;
  return parent.children.some(child => child.id === childId);
}

/**
 * Helper to extract root-level tabs from a tree (without children, for flat rendering)
 */
function getRootTabs(tree: HierarchicalTab[]): TabDefinition[] {
  return tree.map(({ children, ...rest }) => rest);
}

/**
 * Helper to extract children of a specific parent tab.
 * Note: The current architecture supports exactly ONE level of nesting (parent -> children).
 * If deeper nesting is ever needed, the hierarchical API (getTabTreeForEntity) should be used
 * instead of these legacy flat exports. This guard validates the constraint.
 */
function getChildTabs(tree: HierarchicalTab[], parentId: string): TabDefinition[] {
  const parent = tree.find(t => t.id === parentId);
  if (!parent?.children) return [];
  
  // Guard: ensure no grandchildren exist in the tree
  for (const child of parent.children) {
    if (child.children && child.children.length > 0) {
      console.warn(
        `[tabRegistry] Tab "${child.id}" has nested children. ` +
        `The flat export API only supports one level of nesting. ` +
        `Use getTabTreeForEntity() for hierarchical access.`
      );
    }
  }
  
  return parent.children.map(({ children, ...c }) => ({ ...c, parent: parentId }));
}

// Legacy flat exports - derived programmatically from the canonical tree
// These maintain backwards compatibility for any code still using the flat structure
export const workerTabs: TabDefinition[] = getRootTabs(workerTabTree);
export const workerIdentitySubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'identity');
export const workerContactSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'contact');
export const workerCommSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'comm');
export const workerEmploymentSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'employment');
export const workerBenefitsSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'benefits');
export const workerUnionSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'union');
export const workerDispatchSubTabs: TabDefinition[] = getChildTabs(workerTabTree, 'dispatch');
export const allWorkerTabs: TabDefinition[] = flattenTabTree(workerTabTree);

export const employerTabs: TabDefinition[] = getRootTabs(employerTabTree);
export const employerAccountingSubTabs: TabDefinition[] = getChildTabs(employerTabTree, 'accounting');
export const employerUnionSubTabs: TabDefinition[] = getChildTabs(employerTabTree, 'union');
export const allEmployerTabs: TabDefinition[] = flattenTabTree(employerTabTree);

export const providerTabs: TabDefinition[] = getRootTabs(providerTabTree);
export const allProviderTabs: TabDefinition[] = flattenTabTree(providerTabTree);

export const tabRegistry: Record<TabEntityType, TabDefinition[]> = {
  worker: allWorkerTabs,
  employer: allEmployerTabs,
  employer_contact: [],
  provider: allProviderTabs,
  provider_contact: [],
  policy: flattenTabTree(policyTabTree),
  event: flattenTabTree(eventTabTree),
  bargaining_unit: flattenTabTree(bargainingUnitTabTree),
  btu_csg: flattenTabTree(btuCsgTabTree),
  cron_job: flattenTabTree(cronJobTabTree),
  dispatch_job: flattenTabTree(dispatchJobTabTree),
  dispatch_job_type: flattenTabTree(dispatchJobTypeTabTree),
  ledger_account: flattenTabTree(ledgerAccountTabTree),
  ledger_payment: flattenTabTree(ledgerPaymentTabTree),
  trust_benefit: flattenTabTree(trustBenefitTabTree),
  worker_hours: flattenTabTree(workerHoursTabTree),
  user: flattenTabTree(userTabTree),
};

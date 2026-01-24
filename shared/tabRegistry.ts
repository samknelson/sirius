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
  | 'dispatch'
  | 'dispatch_job'
  | 'dispatch_job_type'
  | 'edls_sheet'
  | 'ledger_account'
  | 'ledger_payment'
  | 'trust_benefit'
  | 'worker_hours'
  | 'user'
  | 'ws_client';

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
 * - 'worker.view' policy: Grants access to staff OR worker viewing their own record (default for most tabs)
 * - permission-based: Staff-only tabs that workers cannot access even for their own record
 */
export const workerTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/workers/{id}', policyId: 'worker.view' },
  { 
    id: 'identity', label: 'Identity', hrefTemplate: '/workers/{id}/name', policyId: 'worker.view',
    children: [
      { id: 'name', label: 'Name', hrefTemplate: '/workers/{id}/name', policyId: 'worker.view' },
      { id: 'ids', label: 'IDs', hrefTemplate: '/workers/{id}/ids', permission: 'staff' },
      { id: 'birth-date', label: 'Birth Date', hrefTemplate: '/workers/{id}/birth-date', policyId: 'worker.view' },
      { id: 'gender', label: 'Gender', hrefTemplate: '/workers/{id}/gender', policyId: 'worker.view' },
      { id: 'work-status', label: 'Work Status', hrefTemplate: '/workers/{id}/work-status', permission: 'staff' },
      { id: 'member-status', label: 'Member Status', hrefTemplate: '/workers/{id}/member-status', permission: 'staff' },
      { id: 'user', label: 'User', hrefTemplate: '/workers/{id}/user', permission: 'staff' },
      { id: 'skills', label: 'Skills', hrefTemplate: '/workers/{id}/skills', policyId: 'worker.view', component: 'worker.skills' },
      { id: 'certifications', label: 'Certifications', hrefTemplate: '/workers/{id}/certifications', policyId: 'worker.view', component: 'worker.certifications' },
      { id: 'ratings', label: 'Ratings', hrefTemplate: '/workers/{id}/ratings', permission: 'staff', component: 'worker.ratings' },
      { id: 'bans', label: 'Bans', hrefTemplate: '/workers/{id}/bans', policyId: 'worker.view', component: 'dispatch' },
    ]
  },
  { 
    id: 'contact', label: 'Contact', hrefTemplate: '/workers/{id}/addresses', policyId: 'worker.view',
    children: [
      { id: 'email', label: 'Email', hrefTemplate: '/workers/{id}/email', permission: 'staff' },
      { id: 'addresses', label: 'Addresses', hrefTemplate: '/workers/{id}/addresses', policyId: 'worker.view' },
      { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/workers/{id}/phone-numbers', policyId: 'worker.view' },
    ]
  },
  { 
    id: 'comm', label: 'Comm', hrefTemplate: '/workers/{id}/comm/history', permission: 'staff',
    children: [
      { id: 'comm-history', label: 'History', hrefTemplate: '/workers/{id}/comm/history', permission: 'staff' },
      { id: 'send-sms', label: 'Send SMS', hrefTemplate: '/workers/{id}/comm/send-sms', permission: 'workers.comm' },
      { id: 'send-email', label: 'Send Email', hrefTemplate: '/workers/{id}/comm/send-email', permission: 'workers.comm' },
      { id: 'send-postal', label: 'Send Postal', hrefTemplate: '/workers/{id}/comm/send-postal', permission: 'workers.comm' },
      { id: 'send-inapp', label: 'Send In-App', hrefTemplate: '/workers/{id}/comm/send-inapp', permission: 'workers.comm' },
    ]
  },
  { 
    id: 'employment', label: 'Employment', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker.view',
    children: [
      { id: 'current', label: 'Current', hrefTemplate: '/workers/{id}/employment/current', policyId: 'worker.view' },
      { id: 'history', label: 'History', hrefTemplate: '/workers/{id}/employment/history', policyId: 'worker.view' },
      { id: 'monthly', label: 'Monthly', hrefTemplate: '/workers/{id}/employment/monthly', policyId: 'worker.view' },
      { id: 'daily', label: 'Daily', hrefTemplate: '/workers/{id}/employment/daily', policyId: 'worker.view' },
    ]
  },
  { 
    id: 'benefits', label: 'Benefits', hrefTemplate: '/workers/{id}/benefits/history', permission: 'staff',
    children: [
      { id: 'benefits-history', label: 'History', hrefTemplate: '/workers/{id}/benefits/history', permission: 'staff' },
      { id: 'benefits-eligibility', label: 'Eligibility', hrefTemplate: '/workers/{id}/benefits/eligibility', permission: 'staff' },
      { id: 'benefits-scan', label: 'Scan', hrefTemplate: '/workers/{id}/benefits/scan', permission: 'staff' },
    ]
  },
  { 
    id: 'union', label: 'Union', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker.view', component: 'cardcheck|bargainingunits|worker.steward',
    children: [
      { id: 'cardchecks', label: 'Cardchecks', hrefTemplate: '/workers/{id}/union/cardchecks', policyId: 'worker.view', component: 'cardcheck' },
      { id: 'bargaining-unit', label: 'Bargaining Unit', hrefTemplate: '/workers/{id}/union/bargaining-unit', permission: 'staff', component: 'bargainingunits' },
      { id: 'steward', label: 'Steward', hrefTemplate: '/workers/{id}/union/steward', permission: 'staff', component: 'worker.steward', termKey: 'steward' },
      { id: 'representatives', label: 'Representatives', hrefTemplate: '/workers/{id}/union/representatives', policyId: 'worker.view', component: 'worker.steward' },
    ]
  },
  { 
    id: 'dispatch', label: 'Dispatch', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker.view', component: 'dispatch',
    children: [
      { id: 'dispatch-status', label: 'Status', hrefTemplate: '/workers/{id}/dispatch/status', policyId: 'worker.view', component: 'dispatch' },
      { id: 'dispatch-dnc', label: 'Do Not Call', hrefTemplate: '/workers/{id}/dispatch/do-not-call', policyId: 'worker.view', component: 'dispatch.dnc' },
      { id: 'dispatch-hfe', label: 'Hold for Employer', hrefTemplate: '/workers/{id}/dispatch/hold-for-employer', policyId: 'worker.view', component: 'dispatch.hfe' },
    ]
  },
  { id: 'accounting', label: 'Accounting', hrefTemplate: '/workers/{id}/ledger/accounts', permission: 'ledger.view', component: 'ledger' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/workers/{id}/logs', permission: 'staff' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/workers/{id}/delete', permission: 'workers.delete' },
];

/**
 * Employer entity tab tree
 */
export const employerTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/employers/{id}', policyId: 'employer.view' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/employers/{id}/edit', permission: 'staff' },
  { id: 'workers', label: 'Workers', hrefTemplate: '/employers/{id}/workers', policyId: 'employer.mine' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/employers/{id}/contacts', policyId: 'employer.mine' },
  { id: 'policy-history', label: 'Policy History', hrefTemplate: '/employers/{id}/policy-history', permission: 'staff' },
  { id: 'wizards', label: 'Wizards', hrefTemplate: '/employers/{id}/wizards', permission: 'staff' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/employers/{id}/logs', permission: 'staff' },
  { 
    id: 'accounting', label: 'Accounting', hrefTemplate: '/employers/{id}/ledger/accounts', policyId: 'employer.ledger', component: 'ledger',
    children: [
      { id: 'accounts', label: 'Accounts', hrefTemplate: '/employers/{id}/ledger/accounts', policyId: 'employer.ledger' },
      { id: 'payment-methods', label: 'Payment Methods', hrefTemplate: '/employers/{id}/ledger/stripe/payment_methods', policyId: 'employer.ledger' },
      { id: 'customer', label: 'Customer', hrefTemplate: '/employers/{id}/ledger/stripe/customer', policyId: 'employer.ledger' },
    ]
  },
  { 
    id: 'union', label: 'Union', hrefTemplate: '/employers/{id}/union/stewards', permission: 'staff', component: 'worker.steward',
    children: [
      { id: 'stewards', label: 'Stewards', hrefTemplate: '/employers/{id}/union/stewards', permission: 'staff', component: 'worker.steward', termKey: 'steward', termPlural: true },
    ]
  },
  { id: 'dispatch', label: 'Dispatch', hrefTemplate: '/employers/{id}/dispatch', permission: 'staff', component: 'dispatch' },
];

/**
 * Provider entity tab tree
 */
export const providerTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/trust/provider/{id}', policyId: 'trust.provider.mine' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust/provider/{id}/edit', permission: 'staff' },
  { id: 'contacts', label: 'Contacts', hrefTemplate: '/trust/provider/{id}/contacts', policyId: 'trust.provider.mine' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/trust/provider/{id}/logs', permission: 'staff' },
];

/**
 * Policy entity tab tree
 */
export const policyTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/policies/{id}', permission: 'staff' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/policies/{id}/edit', permission: 'policies.edit' },
  { id: 'benefits', label: 'Benefits', hrefTemplate: '/policies/{id}/benefits', permission: 'staff' },
];

/**
 * Event entity tab tree
 */
export const eventTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/events/{id}', permission: 'staff' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/events/{id}/edit', permission: 'events.edit' },
  { id: 'register', label: 'Register', hrefTemplate: '/events/{id}/register', permission: 'events.edit' },
  { id: 'roster', label: 'Roster', hrefTemplate: '/events/{id}/roster', permission: 'staff' },
  { id: 'self-register', label: 'Self-Register', hrefTemplate: '/events/{id}/self-register', permission: 'staff' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/events/{id}/delete', permission: 'events.delete' },
];

/**
 * Bargaining unit entity tab tree
 */
export const bargainingUnitTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/bargaining-units/{id}', permission: 'staff' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/bargaining-units/{id}/edit', permission: 'staff' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/bargaining-units/{id}/delete', permission: 'staff' },
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
 * Dispatch entity tab tree (individual dispatch records)
 */
export const dispatchTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/dispatch/{id}', permission: 'staff', component: 'dispatch' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/dispatch/{id}/edit', permission: 'staff', component: 'dispatch' },
];

/**
 * Dispatch job entity tab tree
 */
export const dispatchJobTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/dispatch/job/{id}', permission: 'staff', component: 'dispatch' },
  { 
    id: 'dispatches', 
    label: 'Dispatches', 
    hrefTemplate: '/dispatch/job/{id}/dispatches/list', 
    permission: 'staff', 
    component: 'dispatch',
    children: [
      { id: 'dispatches-list', label: 'List', hrefTemplate: '/dispatch/job/{id}/dispatches/list', permission: 'staff', component: 'dispatch' },
      { id: 'dispatches-cbn', label: 'Call by Name', hrefTemplate: '/dispatch/job/{id}/dispatches/cbn', permission: 'staff', component: 'dispatch' },
    ]
  },
  { 
    id: 'eligible-workers', 
    label: 'Eligible Workers', 
    hrefTemplate: '/dispatch/job/{id}/eligible-workers/list', 
    permission: 'staff', 
    component: 'dispatch',
    children: [
      { id: 'eligible-workers-list', label: 'List', hrefTemplate: '/dispatch/job/{id}/eligible-workers/list', permission: 'staff', component: 'dispatch' },
      { id: 'eligible-workers-check', label: 'Check', hrefTemplate: '/dispatch/job/{id}/eligible-workers/check', permission: 'staff', component: 'dispatch' },
    ]
  },
  { id: 'edit', label: 'Edit', hrefTemplate: '/dispatch/job/{id}/edit', permission: 'staff', component: 'dispatch' },
];

/**
 * Dispatch job type entity tab tree
 */
export const dispatchJobTypeTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/config/dispatch-job-type/{id}', permission: 'staff', component: 'dispatch' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/config/dispatch-job-type/{id}/edit', permission: 'staff', component: 'dispatch' },
  { id: 'plugins', label: 'Plugins', hrefTemplate: '/config/dispatch-job-type/{id}/plugins', permission: 'staff', component: 'dispatch' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/config/dispatch-job-type/{id}/delete', permission: 'staff', component: 'dispatch' },
];

/**
 * EDLS sheet entity tab tree
 */
export const edlsSheetTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/edls/sheet/{id}', policyId: 'edls.sheet.view', component: 'edls' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/edls/sheet/{id}/edit', policyId: 'edls.sheet.edit', component: 'edls' },
  { id: 'manage', label: 'Manage', hrefTemplate: '/edls/sheet/{id}/manage', policyId: 'edls.sheet.manage', component: 'edls' },
  { id: 'assignments', label: 'Assignments', hrefTemplate: '/edls/sheet/{id}/assignments', policyId: 'edls.sheet.view', component: 'edls' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/edls/sheet/{id}/logs', policyId: 'edls.coordinator', component: 'edls' },
];

/**
 * Ledger account entity tab tree (staff-only admin pages)
 */
export const ledgerAccountTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/ledger/accounts/{id}', policyId: 'staff', component: 'ledger' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/ledger/accounts/{id}/edit', policyId: 'staff', component: 'ledger' },
  { id: 'payments', label: 'Payments', hrefTemplate: '/ledger/accounts/{id}/payments', policyId: 'staff', component: 'ledger' },
  { id: 'transactions', label: 'Transactions', hrefTemplate: '/ledger/accounts/{id}/transactions', policyId: 'staff', component: 'ledger' },
  { id: 'participants', label: 'Participants', hrefTemplate: '/ledger/accounts/{id}/participants', policyId: 'staff', component: 'ledger' },
  { id: 'settings', label: 'Settings', hrefTemplate: '/ledger/accounts/{id}/settings', policyId: 'staff', component: 'ledger' },
];

/**
 * Ledger payment entity tab tree (staff-only admin pages)
 */
export const ledgerPaymentTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/ledger/payment/{id}', policyId: 'staff', component: 'ledger' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/ledger/payment/{id}/edit', policyId: 'staff', component: 'ledger' },
];

/**
 * Trust benefit entity tab tree
 */
export const trustBenefitTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/trust-benefits/{id}', permission: 'staff' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/trust-benefits/{id}/edit', permission: 'staff' },
];

/**
 * Worker hours entry tab tree
 */
export const workerHoursTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/hours/{id}', permission: 'staff' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/hours/{id}/edit', permission: 'workers.edit' },
  { id: 'delete', label: 'Delete', hrefTemplate: '/hours/{id}/delete', permission: 'workers.delete' },
];

/**
 * Employer contact entity tab tree
 */
export const employerContactTabTree: HierarchicalTab[] = [
  { id: 'view', label: 'View', hrefTemplate: '/employer-contacts/{id}', policyId: 'employer.manage' },
  { id: 'edit', label: 'Edit', hrefTemplate: '/employer-contacts/{id}/edit', policyId: 'employer.manage' },
  { id: 'name', label: 'Name', hrefTemplate: '/employer-contacts/{id}/name', policyId: 'employer.manage' },
  { id: 'email', label: 'Email', hrefTemplate: '/employer-contacts/{id}/email', policyId: 'employer.manage' },
  { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/employer-contacts/{id}/phone-numbers', policyId: 'employer.manage' },
  { id: 'addresses', label: 'Addresses', hrefTemplate: '/employer-contacts/{id}/addresses', policyId: 'employer.manage' },
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
  { id: 'user', label: 'User', hrefTemplate: '/employer-contacts/{id}/user', policyId: 'employer.manage' },
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
  { id: 'user', label: 'User', hrefTemplate: '/trust-provider-contacts/{id}/user', permission: 'admin' },
];

/**
 * User entity tab tree
 */
export const userTabTree: HierarchicalTab[] = [
  { id: 'details', label: 'Details', hrefTemplate: '/users/{id}', permission: 'admin' },
  { 
    id: 'contact', 
    label: 'Contact', 
    hrefTemplate: '/users/{id}/contact/email', 
    permission: 'admin',
    children: [
      { id: 'email', label: 'Email', hrefTemplate: '/users/{id}/contact/email', permission: 'admin' },
      { id: 'phone-numbers', label: 'Phone Numbers', hrefTemplate: '/users/{id}/contact/phone-numbers', permission: 'admin' },
      { id: 'addresses', label: 'Addresses', hrefTemplate: '/users/{id}/contact/addresses', permission: 'admin' },
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
  { id: 'logs', label: 'Logs', hrefTemplate: '/users/{id}/logs', permission: 'admin' },
];

/**
 * Web service client entity tab tree
 */
export const wsClientTabTree: HierarchicalTab[] = [
  { id: 'settings', label: 'Settings', hrefTemplate: '/config/ws/clients/{id}', permission: 'admin' },
  { id: 'credentials', label: 'Credentials', hrefTemplate: '/config/ws/clients/{id}/credentials', permission: 'admin' },
  { id: 'ip-rules', label: 'IP Rules', hrefTemplate: '/config/ws/clients/{id}/ip-rules', permission: 'admin' },
  { id: 'test', label: 'Test', hrefTemplate: '/config/ws/clients/{id}/test', permission: 'admin' },
  { id: 'logs', label: 'Logs', hrefTemplate: '/config/ws/clients/{id}/logs', permission: 'admin' },
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
  dispatch: dispatchTabTree,
  dispatch_job: dispatchJobTabTree,
  dispatch_job_type: dispatchJobTypeTabTree,
  edls_sheet: edlsSheetTabTree,
  ledger_account: ledgerAccountTabTree,
  ledger_payment: ledgerPaymentTabTree,
  trust_benefit: trustBenefitTabTree,
  worker_hours: workerHoursTabTree,
  user: userTabTree,
  ws_client: wsClientTabTree,
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
 * Access requirements extracted from a tab definition.
 * Provides a single source of truth for route protection.
 */
export interface TabAccessRequirements {
  policyId?: string;
  permission?: string;
  component?: string;
}

/**
 * Get access requirements for a specific tab by ID and entity type.
 * Returns the policy, permission, and component requirements from the tab registry.
 * This is the single source of truth for both frontend route protection and backend middleware.
 */
export function getTabAccessRequirements(
  entityType: TabEntityType,
  tabId: string
): TabAccessRequirements | null {
  const tree = tabTreeRegistry[entityType];
  if (!tree) return null;
  
  const tab = findTabById(tabId, tree);
  if (!tab) return null;
  
  return {
    policyId: tab.policyId,
    permission: tab.permission,
    component: tab.component,
  };
}

/**
 * Get a tab by ID for a specific entity type.
 * Returns the full tab definition including all access metadata.
 */
export function getTabForEntity(
  entityType: TabEntityType,
  tabId: string
): HierarchicalTab | undefined {
  const tree = tabTreeRegistry[entityType];
  if (!tree) return undefined;
  return findTabById(tabId, tree);
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
  dispatch: flattenTabTree(dispatchTabTree),
  dispatch_job: flattenTabTree(dispatchJobTabTree),
  dispatch_job_type: flattenTabTree(dispatchJobTypeTabTree),
  edls_sheet: flattenTabTree(edlsSheetTabTree),
  ledger_account: flattenTabTree(ledgerAccountTabTree),
  ledger_payment: flattenTabTree(ledgerPaymentTabTree),
  trust_benefit: flattenTabTree(trustBenefitTabTree),
  worker_hours: flattenTabTree(workerHoursTabTree),
  user: flattenTabTree(userTabTree),
  ws_client: flattenTabTree(wsClientTabTree),
};

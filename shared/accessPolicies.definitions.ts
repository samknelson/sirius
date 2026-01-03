/**
 * Access Policy Definitions
 * 
 * All access policies for the application are defined here in a single place.
 * Import this file to register all policies with the registry.
 */

import { 
  defineRoutePolicy, 
  defineEntityPolicy, 
  permissionPolicy,
  type AccessRule 
} from './accessPolicies';

// ============================================================================
// ROUTE-LEVEL POLICIES
// These are used with requireAccess() middleware to protect API routes
// ============================================================================

// --- Basic Access ---

defineRoutePolicy(
  'authenticated',
  'Authenticated Users',
  'Requires user to be authenticated',
  [{ authenticated: true }]
);

defineRoutePolicy(
  'admin',
  'Admin Access',
  'Requires admin permission',
  [{ authenticated: true, permission: 'admin' }]
);

defineRoutePolicy(
  'staff',
  'Staff Access',
  'Requires staff permission',
  [{ authenticated: true, permission: 'staff' }]
);

// --- Worker Management ---

permissionPolicy('workers.view', 'workers.view', 'View Workers', 'Requires workers.view permission');
permissionPolicy('workers.manage', 'workers.manage', 'Manage Workers', 'Requires workers.manage permission');

defineRoutePolicy(
  'workers.viewOrManage',
  'View or Manage Workers',
  'Requires either workers.view or workers.manage permission',
  [{ authenticated: true, anyPermission: ['workers.view', 'workers.manage'] }]
);

// Route-level policy for individual worker pages (staff or worker owner)
// This is used as a route guard; entity-level checks use worker.view
defineRoutePolicy(
  'worker',
  'Worker Access',
  'Requires staff permission or worker permission with matching worker',
  [
    { authenticated: true, permission: 'staff' },
    { authenticated: true, permission: 'worker', linkage: 'ownsWorker' },
  ]
);

// --- Employer Management ---

permissionPolicy('employers.view', 'employers.view', 'View Employers', 'Requires employers.view permission');
permissionPolicy('employers.manage', 'employers.manage', 'Manage Employers', 'Requires employers.manage permission');

// Route-level policy for employer portal access (staff or employer contact)
defineRoutePolicy(
  'employerUser',
  'Employer Portal Access',
  'Requires staff permission or employer permission with employer association',
  [
    { authenticated: true, permission: 'staff' },
    { authenticated: true, permission: 'employer', linkage: 'employerAssociation' },
  ]
);

// Route-level policy for viewing employer pages (staff or employer contact)
defineRoutePolicy(
  'employersView',
  'Employer View Access',
  'Requires staff or employer permission to view employer data',
  [
    { authenticated: true, permission: 'staff' },
    { authenticated: true, permission: 'employer', linkage: 'employerAssociation' },
  ]
);

// --- Benefits Management ---

permissionPolicy('benefits.view', 'benefits.view', 'View Benefits', 'Requires benefits.view permission');
permissionPolicy('benefits.manage', 'benefits.manage', 'Manage Benefits', 'Requires benefits.manage permission');

// --- Masquerade ---

defineRoutePolicy(
  'masquerade',
  'Masquerade',
  'Requires masquerade or admin permission',
  [{ authenticated: true, anyPermission: ['masquerade', 'admin'] }]
);

// --- Ledger ---

defineRoutePolicy(
  'ledger.staff',
  'Ledger Staff Access',
  'Requires ledger component and ledger.staff permission',
  [{ authenticated: true, component: 'ledger', permission: 'ledger.staff' }]
);

// Alias for backward compatibility with client code
defineRoutePolicy(
  'ledgerStaff',
  'Ledger Staff Access (Alias)',
  'Requires ledger component and ledger.staff permission',
  [{ authenticated: true, component: 'ledger', permission: 'ledger.staff' }]
);

defineRoutePolicy(
  'ledger.stripe.admin',
  'Ledger Stripe Administration',
  'Requires admin permission and ledger.stripe component',
  [{ authenticated: true, component: 'ledger.stripe', permission: 'admin' }]
);

// Alias for backward compatibility with client code
defineRoutePolicy(
  'ledgerStripeAdmin',
  'Ledger Stripe Administration (Alias)',
  'Requires admin permission and ledger.stripe component',
  [{ authenticated: true, component: 'ledger.stripe', permission: 'admin' }]
);

defineRoutePolicy(
  'ledger.stripe.employer',
  'Ledger Stripe Employer Access',
  'Requires ledger.stripe component and either ledger.staff or ledger.employer permission',
  [{ authenticated: true, component: 'ledger.stripe', anyPermission: ['ledger.staff', 'ledger.employer'] }]
);

// Alias for backward compatibility with client code
defineRoutePolicy(
  'ledgerStripeEmployer',
  'Ledger Stripe Employer Access (Alias)',
  'Requires ledger.stripe component and either ledger.staff or ledger.employer permission',
  [{ authenticated: true, component: 'ledger.stripe', anyPermission: ['ledger.staff', 'ledger.employer'] }]
);

// --- User Management ---

defineRoutePolicy(
  'employer.userManage',
  'Employer User Management',
  'Requires employer.login component and employer.usermanage permission',
  [{ authenticated: true, component: 'employer.login', permission: 'employer.usermanage' }]
);

// Alias for backward compatibility with client code
defineRoutePolicy(
  'employerUserManage',
  'Employer User Management (Alias)',
  'Requires employer.login component and employer.usermanage permission',
  [{ authenticated: true, component: 'employer.login', permission: 'employer.usermanage' }]
);

defineRoutePolicy(
  'trustProvider.userManage',
  'Trust Provider User Management',
  'Requires trust.providers.login component and trustprovider.usermanage permission',
  [{ authenticated: true, component: 'trust.providers.login', permission: 'trustprovider.usermanage' }]
);

// Alias for backward compatibility with client code
defineRoutePolicy(
  'trustProviderUserManage',
  'Trust Provider User Management (Alias)',
  'Requires trust.providers.login component and trustprovider.usermanage permission',
  [{ authenticated: true, component: 'trust.providers.login', permission: 'trustprovider.usermanage' }]
);

// ============================================================================
// ENTITY-LEVEL POLICIES
// These are used for fine-grained access to specific entities
// ============================================================================

// --- Worker Entity Policies ---

defineEntityPolicy(
  'worker.view',
  'View Worker',
  'View a specific worker record',
  'worker',
  [
    // Staff can view any worker
    { permission: 'staff' },
    // Worker permission + owns this worker
    { permission: 'worker', linkage: 'ownsWorker' },
    // Benefit provider for this worker
    { permission: 'trustprovider', linkage: 'workerBenefitProvider' },
  ]
);

defineEntityPolicy(
  'worker.edit',
  'Edit Worker',
  'Edit a specific worker record',
  'worker',
  [
    // Only staff with workers.manage can edit
    { permission: 'workers.manage' },
  ]
);

// --- Employer Entity Policies ---

defineEntityPolicy(
  'employer.view',
  'View Employer',
  'View a specific employer record',
  'employer',
  [
    // Staff can view any employer
    { permission: 'staff' },
    // Employer permission + associated with this employer
    { permission: 'employer', linkage: 'employerAssociation' },
    // Worker with employment history at this employer
    { permission: 'worker', linkage: 'workerEmploymentHistory' },
  ]
);

defineEntityPolicy(
  'employer.edit',
  'Edit Employer',
  'Edit a specific employer record',
  'employer',
  [
    // Staff with employers.manage can edit any employer
    { permission: 'employers.manage' },
    // Employer contact with employer.usermanage permission
    { all: [
      { permission: 'employer.usermanage' },
      { linkage: 'employerAssociation' },
    ]},
  ]
);

// --- Provider Entity Policies ---

defineEntityPolicy(
  'provider.view',
  'View Provider',
  'View a specific trust provider record',
  'provider',
  [
    { permission: 'staff' },
    { permission: 'trustprovider', linkage: 'providerAssociation' },
  ]
);

defineEntityPolicy(
  'provider.edit',
  'Edit Provider',
  'Edit a specific trust provider record',
  'provider',
  [
    { permission: 'benefits.manage' },
  ]
);

// --- File Entity Policies ---

defineEntityPolicy(
  'file.read',
  'Read File',
  'Read/download a specific file',
  'file',
  [
    // Uploader always has access
    { linkage: 'fileUploader' },
    // Staff can read any file
    { permission: 'staff' },
    // Users with files.read-private
    { permission: 'files.read-private' },
  ]
);

defineEntityPolicy(
  'file.update',
  'Update File',
  'Update file metadata',
  'file',
  [
    // Uploader can update their files
    { linkage: 'fileUploader' },
    // Users with files.update permission
    { permission: 'files.update' },
  ]
);

defineEntityPolicy(
  'file.delete',
  'Delete File',
  'Delete a file',
  'file',
  [
    // Uploader can delete their files
    { linkage: 'fileUploader' },
    // Users with files.delete permission
    { permission: 'files.delete' },
  ]
);

// ============================================================================
// SPECIAL ROUTE POLICIES WITH ENTITY CONTEXT
// These are route-level but use linkage predicates for ownership checks
// ============================================================================

defineRoutePolicy(
  'worker.self',
  'Worker Self Access',
  'Requires staff permission, or worker permission with matching worker',
  [
    { permission: 'staff' },
    { permission: 'worker', linkage: 'ownsWorker' },
  ]
);

defineRoutePolicy(
  'employer.self',
  'Employer Self Access',
  'Requires staff permission, or employer permission with employer association',
  [
    { permission: 'staff' },
    { permission: 'employer', linkage: 'employerAssociation' },
  ]
);

// ============================================================================
// FILE ROUTE POLICIES
// These are route-level policies for file operations
// ============================================================================

defineRoutePolicy(
  'files.upload',
  'Upload Files',
  'Requires files.upload permission or appropriate entity manage permission',
  [
    { authenticated: true, permission: 'files.upload' },
    { authenticated: true, permission: 'workers.manage' },
    { authenticated: true, permission: 'employers.manage' },
  ]
);

// ============================================================================
// DISPATCH POLICIES
// ============================================================================

defineRoutePolicy(
  'dispatch.view',
  'View Dispatch',
  'Requires dispatch.view permission',
  [{ authenticated: true, component: 'dispatch', permission: 'dispatch.view' }]
);

defineRoutePolicy(
  'dispatch.manage',
  'Manage Dispatch',
  'Requires dispatch.manage permission',
  [{ authenticated: true, component: 'dispatch', permission: 'dispatch.manage' }]
);

// ============================================================================
// EVENTS POLICIES
// ============================================================================

permissionPolicy('events.view', 'events.view', 'View Events', 'Requires events.view permission');
permissionPolicy('events.manage', 'events.manage', 'Manage Events', 'Requires events.manage permission');

// ============================================================================
// POLICY/COVERAGE MANAGEMENT
// ============================================================================

permissionPolicy('policies.view', 'policies.view', 'View Policies', 'Requires policies.view permission');
permissionPolicy('policies.manage', 'policies.manage', 'Manage Policies', 'Requires policies.manage permission');

// ============================================================================
// SETTINGS & ADMIN
// ============================================================================

permissionPolicy('settings.manage', 'settings.manage', 'Manage Settings', 'Requires settings.manage permission');
permissionPolicy('wizards.manage', 'wizards.manage', 'Manage Wizards', 'Requires wizards.manage permission');
permissionPolicy('terminology.manage', 'terminology.manage', 'Manage Terminology', 'Requires terminology.manage permission');

// ============================================================================
// ALERTS
// ============================================================================

permissionPolicy('alerts.view', 'alerts.view', 'View Alerts', 'Requires alerts.view permission');
permissionPolicy('alerts.manage', 'alerts.manage', 'Manage Alerts', 'Requires alerts.manage permission');

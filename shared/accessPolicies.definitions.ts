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


defineRoutePolicy(
  'ledger.stripe.admin',
  'Ledger Stripe Administration',
  'Requires admin permission and ledger.stripe component',
  [{ authenticated: true, component: 'ledger.stripe', permission: 'admin' }]
);

defineRoutePolicy(
  'ledger.stripe.employer',
  'Ledger Stripe Employer Access',
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

defineRoutePolicy(
  'trustProvider.userManage',
  'Trust Provider User Management',
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

// ============================================================================
// FILE ROUTE POLICIES
// These are route-level policies for file operations
// ============================================================================

defineRoutePolicy(
  'files.upload',
  'Upload Files',
  'Requires files.upload permission or staff permission',
  [
    { authenticated: true, permission: 'files.upload' },
    { authenticated: true, permission: 'staff' },
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


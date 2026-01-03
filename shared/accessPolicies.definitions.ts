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
  'authenticated',
  'Requires user to be authenticated',
  [{ authenticated: true }]
);

defineRoutePolicy(
  'admin',
  'admin',
  'Requires admin permission',
  [{ authenticated: true, permission: 'admin' }]
);

defineRoutePolicy(
  'staff',
  'staff',
  'Requires staff permission',
  [{ authenticated: true, permission: 'staff' }]
);

// --- Masquerade ---

defineRoutePolicy(
  'masquerade',
  'masquerade',
  'Requires masquerade or admin permission',
  [{ authenticated: true, anyPermission: ['masquerade', 'admin'] }]
);

// --- Ledger ---

defineRoutePolicy(
  'ledger.staff',
  'ledger.staff',
  'Requires ledger component and ledger.staff permission',
  [{ authenticated: true, component: 'ledger', permission: 'ledger.staff' }]
);


defineRoutePolicy(
  'ledger.stripe.admin',
  'ledger.stripe.admin',
  'Requires admin permission and ledger.stripe component',
  [{ authenticated: true, component: 'ledger.stripe', permission: 'admin' }]
);

defineRoutePolicy(
  'ledger.stripe.employer',
  'ledger.stripe.employer',
  'Requires ledger.stripe component and either ledger.staff or ledger.employer permission',
  [{ authenticated: true, component: 'ledger.stripe', anyPermission: ['ledger.staff', 'ledger.employer'] }]
);

// --- User Management ---

defineRoutePolicy(
  'employer.userManage',
  'employer.userManage',
  'Requires employer.login component and employer.usermanage permission',
  [{ authenticated: true, component: 'employer.login', permission: 'employer.usermanage' }]
);

defineRoutePolicy(
  'trustProvider.userManage',
  'trustProvider.userManage',
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
  'worker.view',
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
  'worker.edit',
  'Edit a specific worker record (excludes trust providers)',
  'worker',
  [
    // Staff can edit any worker
    { permission: 'staff' },
    // Worker permission + owns this worker
    { permission: 'worker', linkage: 'ownsWorker' },
  ]
);

// --- Employer Entity Policies ---

defineEntityPolicy(
  'employer.view',
  'employer.view',
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
  'file.read',
  'Read/download a specific file',
  'file',
  [
    // Uploader always has access
    { linkage: 'fileUploader' },
    // Staff can read any file
    { permission: 'staff' },
    // Users with files.read-private
    { permission: 'files.read-private' },
    // Delegate to entity policy based on file's entity_type
    { linkage: 'fileEntityAccess' },
  ]
);

defineEntityPolicy(
  'file.update',
  'file.update',
  'Update file metadata',
  'file',
  [
    // Uploader can update their files
    { linkage: 'fileUploader' },
    // Users with files.update permission
    { permission: 'files.update' },
    // Delegate to entity policy based on file's entity_type
    { linkage: 'fileEntityAccess' },
  ]
);

defineEntityPolicy(
  'file.delete',
  'file.delete',
  'Delete a file',
  'file',
  [
    // Uploader can delete their files
    { linkage: 'fileUploader' },
    // Users with files.delete permission
    { permission: 'files.delete' },
    // Delegate to entity policy based on file's entity_type
    { linkage: 'fileEntityAccess' },
  ]
);

// --- Cardcheck Entity Policies ---

defineEntityPolicy(
  'cardcheck.view',
  'cardcheck.view',
  'View a specific cardcheck record (delegates to worker.view)',
  'cardcheck',
  [
    // Staff can view any cardcheck
    { permission: 'staff' },
    // Delegate to worker.view via cardcheck.workerId
    { linkage: 'cardcheckWorkerAccess' },
  ]
);

defineEntityPolicy(
  'cardcheck.edit',
  'cardcheck.edit',
  'Edit a specific cardcheck record (delegates to worker.edit)',
  'cardcheck',
  [
    // Staff can edit any cardcheck
    { permission: 'staff' },
    // Delegate to worker.edit via cardcheck.workerId
    { linkage: 'cardcheckWorkerAccess' },
  ]
);

// --- Esig Entity Policies ---

defineEntityPolicy(
  'esig.view',
  'esig.view',
  'View a specific esig record (delegates based on doc_type)',
  'esig',
  [
    // Staff can view any esig
    { permission: 'staff' },
    // Delegate to entity policy based on doc_type
    { linkage: 'esigEntityAccess' },
  ]
);

defineEntityPolicy(
  'esig.edit',
  'esig.edit',
  'Edit a specific esig record (delegates based on doc_type)',
  'esig',
  [
    // Staff can edit any esig
    { permission: 'staff' },
    // Delegate to entity policy based on doc_type
    { linkage: 'esigEntityAccess' },
  ]
);

// --- Contact Entity Policies ---

defineEntityPolicy(
  'contact.view',
  'contact.view',
  'View a specific contact record (via linked worker/employer/provider access)',
  'contact',
  [
    // Staff can view any contact
    { permission: 'staff' },
    // User owns a worker that uses this contact
    { permission: 'worker', linkage: 'contactWorkerOwner' },
    // User is a benefit provider for a worker that uses this contact
    { permission: 'trustprovider', linkage: 'contactWorkerProvider' },
    // User is associated with an employer that uses this contact
    { permission: 'employer', linkage: 'contactEmployerAssoc' },
    // User is associated with a provider that uses this contact
    { permission: 'trustprovider', linkage: 'contactProviderAssoc' },
  ]
);

defineEntityPolicy(
  'contact.edit',
  'contact.edit',
  'Edit a specific contact record (staff or workers editing their own contact)',
  'contact',
  [
    // Staff can edit any contact
    { permission: 'staff' },
    // User owns a worker that uses this contact (self-service editing)
    { permission: 'worker', linkage: 'contactWorkerOwner' },
  ]
);

// ============================================================================
// FILE ROUTE POLICIES
// These are route-level policies for file operations
// ============================================================================

defineRoutePolicy(
  'files.upload',
  'files.upload',
  'Requires files.upload permission or staff permission',
  [
    { authenticated: true, permission: 'files.upload' },
    { authenticated: true, permission: 'staff' },
  ]
);



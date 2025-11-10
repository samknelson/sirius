import type { AccessPolicy } from './accessControl';

/**
 * Common access policies for the Sirius application
 * 
 * Note: All policies automatically grant access to users with the "admin" permission
 */

/**
 * Require authentication only
 */
export const authenticated: AccessPolicy = {
  name: 'Authenticated Users',
  description: 'Requires user to be authenticated',
  requirements: [{ type: 'authenticated' }],
};

/**
 * Admin management policies
 */
export const admin: AccessPolicy = {
  name: 'Admin Access',
  description: 'Requires admin permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'admin' },
  ],
};

export const adminManage: AccessPolicy = {
  name: 'Admin Management',
  description: 'Requires admin.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'admin.manage' },
  ],
};

/**
 * Worker management policies
 */
export const workersView: AccessPolicy = {
  name: 'View Workers',
  description: 'Requires workers.view permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'workers.view' },
  ],
};

export const workersManage: AccessPolicy = {
  name: 'Manage Workers',
  description: 'Requires workers.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'workers.manage' },
  ],
};

/**
 * Employer management policies
 */
export const employersView: AccessPolicy = {
  name: 'View Employers',
  description: 'Requires employers.view permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'employers.view' },
  ],
};

export const employersManage: AccessPolicy = {
  name: 'Manage Employers',
  description: 'Requires employers.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'employers.manage' },
  ],
};

/**
 * Configuration management policies
 */
export const variablesView: AccessPolicy = {
  name: 'View Variables',
  description: 'Requires variables.view permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'variables.view' },
  ],
};

export const variablesManage: AccessPolicy = {
  name: 'Manage Variables',
  description: 'Requires variables.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'variables.manage' },
  ],
};

/**
 * Trust benefits management policies
 */
export const benefitsView: AccessPolicy = {
  name: 'View Benefits',
  description: 'Requires benefits.view permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'benefits.view' },
  ],
};

export const benefitsManage: AccessPolicy = {
  name: 'Manage Benefits',
  description: 'Requires benefits.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'benefits.manage' },
  ],
};

/**
 * Component management policy
 */
export const components: AccessPolicy = {
  name: 'Manage Components',
  description: 'Requires variables.manage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'variables.manage' },
  ],
};

/**
 * Ledger Stripe administration policy
 */
export const ledgerStripeAdmin: AccessPolicy = {
  name: 'Ledger Stripe Administration',
  description: 'Requires admin permission and ledger.stripe component',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'admin' },
    { type: 'component', componentId: 'ledger.stripe' },
  ],
};

/**
 * Ledger Stripe employer access policy
 */
export const ledgerStripeEmployer: AccessPolicy = {
  name: 'Ledger Stripe Employer Access',
  description: 'Requires ledger.stripe component and either ledger.staff or ledger.employer permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'component', componentId: 'ledger.stripe' },
    {
      type: 'anyPermission',
      keys: ['ledger.staff', 'ledger.employer'],
    },
  ],
};

/**
 * Ledger staff access policy
 */
export const ledgerStaff: AccessPolicy = {
  name: 'Ledger Staff Access',
  description: 'Requires ledger component and ledger.staff permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'component', componentId: 'ledger' },
    { type: 'permission', key: 'ledger.staff' },
  ],
};

/**
 * Bookmark policy
 */
export const bookmark: AccessPolicy = {
  name: 'Bookmark',
  description: 'Requires bookmark permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'bookmark' },
  ],
};

/**
 * Masquerade policy
 */
export const masquerade: AccessPolicy = {
  name: 'Masquerade',
  description: 'Requires masquerade or admin permission',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'anyPermission',
      keys: ['masquerade', 'admin'],
    },
  ],
};

/**
 * Staff access policy
 */
export const staff: AccessPolicy = {
  name: 'Staff Access',
  description: 'Requires staff permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'staff' },
  ],
};

/**
 * Employer user management policy
 */
export const employerUserManage: AccessPolicy = {
  name: 'Employer User Management',
  description: 'Requires employer.login component and employer.usermanage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'component', componentId: 'employer.login' },
    { type: 'permission', key: 'employer.usermanage' },
  ],
};

/**
 * Worker access policy
 * Grants access if user has staff permission, or if they have worker permission
 * and their email matches the worker's contact email
 */
export const worker: AccessPolicy = {
  name: 'Worker Access',
  description: 'Requires staff permission, or worker permission with matching email',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'anyOf',
      options: [
        // Option 1: Has staff permission
        { type: 'permission', key: 'staff' },
        // Option 2: Has worker permission AND email matches worker's contact email
        {
          type: 'allOf',
          options: [
            { type: 'permission', key: 'worker' },
            {
              type: 'custom',
              reason: 'User email must match worker contact email',
              check: async (ctx) => {
                // Get worker ID from route params
                const workerId = ctx.params?.id || ctx.params?.workerId;
                if (!workerId) {
                  return false;
                }

                // Import storage dynamically to avoid circular dependency
                const { storage } = await import('./storage/database');
                
                // Get the worker and their contact
                const worker = await storage.workers.getWorker(workerId);
                if (!worker) {
                  return false;
                }

                const contact = await storage.contacts.getContact(worker.contactId);
                if (!contact || !contact.email) {
                  return false;
                }

                // Check if user's email matches worker's contact email
                return ctx.user?.email === contact.email;
              },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Example: Complex policy with multiple permission options
 */
export const workersViewOrManage: AccessPolicy = {
  name: 'View or Manage Workers',
  description: 'Requires either workers.view or workers.manage permission',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'anyPermission',
      keys: ['workers.view', 'workers.manage'],
    },
  ],
};

/**
 * Export all policies as a registry
 */
export const policies = {
  authenticated,
  admin,
  adminManage,
  workersView,
  workersManage,
  employersView,
  employersManage,
  variablesView,
  variablesManage,
  benefitsView,
  benefitsManage,
  components,
  ledgerStripeAdmin,
  ledgerStripeEmployer,
  ledgerStaff,
  bookmark,
  masquerade,
  staff,
  worker,
  workersViewOrManage,
  employerUserManage,
};

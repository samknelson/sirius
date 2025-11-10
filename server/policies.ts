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
 * Worker user access policy
 * Grants access if user has worker permission and either:
 * - staff permission, OR
 * - their email matches the contact email of the specific worker being accessed
 */
export const workerUser: AccessPolicy = {
  name: 'Worker User Access',
  description: 'Requires worker permission and either staff permission or matching worker contact email',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'worker' },
    {
      type: 'anyOf',
      options: [
        // Option 1: Has staff permission
        { type: 'permission', key: 'staff' },
        // Option 2: User's email matches the worker's contact email
        {
          type: 'custom',
          reason: 'User email must match worker contact email',
          check: async (ctx) => {
            // Get worker ID from route params
            const workerId = ctx.params?.id || ctx.params?.workerId;
            if (!workerId) {
              return false;
            }

            // Get user email
            if (!ctx.user?.email) {
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

            // Check if user's email matches worker's contact email (case-insensitive)
            return ctx.user.email.toLowerCase() === contact.email.toLowerCase();
          },
        },
      ],
    },
  ],
};

/**
 * Employer user access policy
 * Grants access if user has employer permission and either:
 * - staff permission, OR
 * - their email is associated with a contact that has an employer-contact record for the given employer
 */
export const employerUser: AccessPolicy = {
  name: 'Employer User Access',
  description: 'Requires employer permission and either staff permission or associated employer contact',
  requirements: [
    { type: 'authenticated' },
    { type: 'permission', key: 'employer' },
    {
      type: 'anyOf',
      options: [
        // Option 1: Has staff permission
        { type: 'permission', key: 'staff' },
        // Option 2: User is associated with a contact that has an employer-contact record for the employer
        {
          type: 'custom',
          reason: 'User email must match an employer contact for this employer',
          check: async (ctx) => {
            // Get employer ID from route params
            const employerId = ctx.params?.id || ctx.params?.employerId;
            if (!employerId) {
              return false;
            }

            // Get user email
            if (!ctx.user?.email) {
              return false;
            }

            // Import storage dynamically to avoid circular dependency
            const { storage } = await import('./storage/database');
            
            // Find contact with this email
            const contact = await storage.contacts.getContactByEmail(ctx.user.email);
            if (!contact) {
              return false;
            }

            // Check if this contact has an employer-contact record for this employer
            const employerContacts = await storage.employerContacts.listByEmployer(employerId);
            const hasContact = employerContacts.some(ec => ec.contactId === contact.id);
            
            return hasContact;
          },
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
  workersView,
  workersManage,
  employersView,
  employersManage,
  variablesView,
  variablesManage,
  benefitsView,
  benefitsManage,
  ledgerStripeAdmin,
  ledgerStripeEmployer,
  ledgerStaff,
  bookmark,
  masquerade,
  staff,
  worker,
  workerUser,
  employerUser,
  workersViewOrManage,
  employerUserManage,
};

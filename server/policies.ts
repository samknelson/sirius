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
 * Trust provider user management policy
 */
export const trustProviderUserManage: AccessPolicy = {
  name: 'Trust Provider User Management',
  description: 'Requires trust.providers.login component and trustprovider.usermanage permission',
  requirements: [
    { type: 'authenticated' },
    { type: 'component', componentId: 'trust.providers.login' },
    { type: 'permission', key: 'trustprovider.usermanage' },
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
 * File management policies
 * 
 * Files are protected by a layered access control system:
 * 1. Dedicated file permissions (files.upload, files.read-private, files.update, files.delete)
 * 2. Entity-based permissions (workers.manage, employers.manage)
 * 3. Access level (public vs private files)
 * 4. Uploader ownership (users who uploaded a file get implicit access)
 */

/**
 * File upload policy
 * Allows creating files if user has files.upload permission OR
 * the appropriate entity permission (workers.manage, employers.manage)
 */
export const filesUpload: AccessPolicy = {
  name: 'Upload Files',
  description: 'Requires files.upload permission or entity manage permission',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'custom',
      reason: 'Requires files.upload permission or permission to manage the target entity',
      check: async (ctx) => {
        // Import storage dynamically to avoid circular dependency
        const { storage } = await import('./storage/database');
        
        // Check if user has files.upload permission
        if (ctx.user && await storage.users.userHasPermission(ctx.user.id, 'files.upload')) {
          return true;
        }
        
        // Check entity-based permissions from request body
        const entityType = ctx.body?.entityType;
        if (!entityType) {
          return false;
        }
        
        // Map entity type to required permission
        const permissionMap: Record<string, string> = {
          'worker': 'workers.manage',
          'employer': 'employers.manage',
        };
        
        const requiredPermission = permissionMap[entityType];
        if (!requiredPermission) {
          // Unknown entity type - require files.upload
          return false;
        }
        
        // Check if user has the entity-specific permission
        return ctx.user ? await storage.users.userHasPermission(ctx.user.id, requiredPermission) : false;
      },
    },
  ],
};

/**
 * File read policy
 * Layered access based on file's accessLevel and entity association:
 * - Public files: Requires entity view permission
 * - Private files: Requires files.read-private OR entity manage permission
 * - Uploader: Always has read access
 */
export const filesRead: AccessPolicy = {
  name: 'Read Files',
  description: 'Access based on file visibility, entity permissions, or ownership',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'custom',
      reason: 'Access depends on file visibility level and entity permissions',
      check: async (ctx) => {
        // Import storage dynamically to avoid circular dependency
        const { storage } = await import('./storage/database');
        
        if (!ctx.user) {
          return false;
        }
        
        // Get file ID from params
        const fileId = ctx.params?.id || ctx.params?.fileId;
        if (!fileId) {
          return false;
        }
        
        // Load file metadata
        const file = await storage.files.getById(fileId);
        if (!file) {
          return false;
        }
        
        // Check if user uploaded the file
        if (file.uploadedBy === ctx.user.id) {
          return true;
        }
        
        // Check access level and entity permissions
        if (file.accessLevel === 'public' && file.entityType) {
          // Public files: Check entity view permission
          const viewPermissionMap: Record<string, string> = {
            'worker': 'workers.view',
            'employer': 'employers.view',
          };
          
          const viewPermission = viewPermissionMap[file.entityType];
          if (viewPermission && await storage.users.userHasPermission(ctx.user.id, viewPermission)) {
            return true;
          }
        } else if (file.accessLevel === 'private') {
          // Private files: Check files.read-private or entity manage permission
          if (await storage.users.userHasPermission(ctx.user.id, 'files.read-private')) {
            return true;
          }
          
          if (file.entityType) {
            const managePermissionMap: Record<string, string> = {
              'worker': 'workers.manage',
              'employer': 'employers.manage',
            };
            
            const managePermission = managePermissionMap[file.entityType];
            if (managePermission && await storage.users.userHasPermission(ctx.user.id, managePermission)) {
              return true;
            }
          }
        }
        
        return false;
      },
    },
  ],
};

/**
 * File update policy
 * Allows updating file metadata if user has files.update permission OR
 * uploaded the file OR has entity manage permission
 */
export const filesUpdate: AccessPolicy = {
  name: 'Update Files',
  description: 'Requires files.update permission, ownership, or entity manage permission',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'custom',
      reason: 'Requires files.update permission, file ownership, or entity manage permission',
      check: async (ctx) => {
        // Import storage dynamically to avoid circular dependency
        const { storage } = await import('./storage/database');
        
        if (!ctx.user) {
          return false;
        }
        
        // Check if user has files.update permission
        if (await storage.users.userHasPermission(ctx.user.id, 'files.update')) {
          return true;
        }
        
        // Get file ID from params
        const fileId = ctx.params?.id || ctx.params?.fileId;
        if (!fileId) {
          return false;
        }
        
        // Load file metadata
        const file = await storage.files.getById(fileId);
        if (!file) {
          return false;
        }
        
        // Check if user uploaded the file
        if (file.uploadedBy === ctx.user.id) {
          return true;
        }
        
        // Check entity manage permission
        if (file.entityType) {
          const managePermissionMap: Record<string, string> = {
            'worker': 'workers.manage',
            'employer': 'employers.manage',
          };
          
          const managePermission = managePermissionMap[file.entityType];
          if (managePermission && await storage.users.userHasPermission(ctx.user.id, managePermission)) {
            return true;
          }
        }
        
        return false;
      },
    },
  ],
};

/**
 * File delete policy
 * Allows deleting files if user has files.delete permission OR
 * uploaded the file OR has entity manage permission
 */
export const filesDelete: AccessPolicy = {
  name: 'Delete Files',
  description: 'Requires files.delete permission, ownership, or entity manage permission',
  requirements: [
    { type: 'authenticated' },
    {
      type: 'custom',
      reason: 'Requires files.delete permission, file ownership, or entity manage permission',
      check: async (ctx) => {
        // Import storage dynamically to avoid circular dependency
        const { storage } = await import('./storage/database');
        
        if (!ctx.user) {
          return false;
        }
        
        // Check if user has files.delete permission
        if (await storage.users.userHasPermission(ctx.user.id, 'files.delete')) {
          return true;
        }
        
        // Get file ID from params
        const fileId = ctx.params?.id || ctx.params?.fileId;
        if (!fileId) {
          return false;
        }
        
        // Load file metadata
        const file = await storage.files.getById(fileId);
        if (!file) {
          return false;
        }
        
        // Check if user uploaded the file
        if (file.uploadedBy === ctx.user.id) {
          return true;
        }
        
        // Check entity manage permission
        if (file.entityType) {
          const managePermissionMap: Record<string, string> = {
            'worker': 'workers.manage',
            'employer': 'employers.manage',
          };
          
          const managePermission = managePermissionMap[file.entityType];
          if (managePermission && await storage.users.userHasPermission(ctx.user.id, managePermission)) {
            return true;
          }
        }
        
        return false;
      },
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
  trustProviderUserManage,
  filesUpload,
  filesRead,
  filesUpdate,
  filesDelete,
};

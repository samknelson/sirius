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
  bookmark,
  masquerade,
  workersViewOrManage,
};

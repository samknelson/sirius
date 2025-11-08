import { Request, Response, NextFunction } from 'express';
import type { User } from '@shared/schema';

/**
 * Context object containing all information needed for access control decisions
 */
export interface AccessContext {
  user: User | null;
  route: string;
  method: string;
  params: Record<string, any>;
  body?: any;
  query?: any;
  resources?: Record<string, any>;
}

/**
 * Access requirement types
 */
export type AccessRequirement =
  | { type: 'authenticated' }
  | { type: 'permission'; key: string }
  | { type: 'anyPermission'; keys: string[] }
  | { type: 'allPermissions'; keys: string[] }
  | { type: 'component'; componentId: string }
  | { type: 'ownership'; resourceType: string; resourceIdParam?: string }
  | { type: 'anyOf'; options: AccessRequirement[] }
  | { type: 'allOf'; options: AccessRequirement[] }
  | { type: 'custom'; check: (ctx: AccessContext) => Promise<boolean>; reason?: string };

/**
 * Access policy definition
 */
export interface AccessPolicy {
  name: string;
  description?: string;
  requirements: AccessRequirement[];
}

/**
 * Result of an access evaluation
 */
export interface AccessResult {
  granted: boolean;
  reason?: string;
}

/**
 * Detailed requirement evaluation result
 */
export interface RequirementEvaluation {
  type: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
  details?: any;
}

/**
 * Detailed policy evaluation result
 */
export interface DetailedPolicyResult {
  policy: {
    name: string;
    description?: string;
  };
  allowed: boolean;
  evaluatedAt: string;
  adminBypass: boolean;
  requirements: RequirementEvaluation[];
}

/**
 * Storage interface for access control
 */
export interface AccessControlStorage {
  getUserPermissions(userId: string): Promise<string[]>;
  hasPermission(userId: string, permissionKey: string): Promise<boolean>;
  getUserByReplitId(replitUserId: string): Promise<User | undefined>;
  getUser(userId: string): Promise<User | undefined>;
}

let storage: AccessControlStorage | null = null;

/**
 * Initialize the access control module with a storage implementation
 */
export function initAccessControl(storageImpl: AccessControlStorage) {
  storage = storageImpl;
}

/**
 * Build access context from an Express request
 * Handles Replit Auth and masquerading
 */
export async function buildContext(req: Request): Promise<AccessContext> {
  let user: User | null = null;

  // Check if user is authenticated via Replit
  const replitUser = (req as any).user;
  if (replitUser && replitUser.claims && storage) {
    const replitUserId = replitUser.claims.sub;
    const session = (req as any).session;

    // Check if masquerading
    if (session?.masqueradeUserId) {
      const masqueradeUser = await storage.getUser(session.masqueradeUserId);
      if (masqueradeUser) {
        user = masqueradeUser;
      }
    } else {
      // Normal authentication - look up database user by Replit ID
      const dbUser = await storage.getUserByReplitId(replitUserId);
      if (dbUser) {
        user = dbUser;
      }
    }
  }

  return {
    user,
    route: req.route?.path || req.path,
    method: req.method,
    params: req.params,
    body: req.body,
    query: req.query,
    resources: {},
  };
}

/**
 * Check if user has admin permission (bypasses all access checks)
 */
async function hasAdminPermission(userId: string): Promise<boolean> {
  if (!storage) {
    throw new Error('Access control storage not initialized');
  }
  return storage.hasPermission(userId, 'admin');
}

/**
 * Get a human-readable description for a requirement
 */
function getRequirementDescription(requirement: AccessRequirement): string {
  switch (requirement.type) {
    case 'authenticated':
      return 'Must be logged in';
    case 'permission':
      return `Requires permission: ${requirement.key}`;
    case 'anyPermission':
      return `Requires any of: ${requirement.keys.join(', ')}`;
    case 'allPermissions':
      return `Requires all of: ${requirement.keys.join(', ')}`;
    case 'component':
      return `Component '${requirement.componentId}' must be enabled`;
    case 'ownership':
      return 'Must own the resource';
    case 'anyOf':
      return 'Requires at least one condition to be met';
    case 'allOf':
      return 'Requires all conditions to be met';
    case 'custom':
      return requirement.reason || 'Custom check required';
    default:
      return 'Unknown requirement';
  }
}

/**
 * Evaluate a single access requirement
 */
async function evaluateRequirement(
  requirement: AccessRequirement,
  context: AccessContext
): Promise<AccessResult> {
  switch (requirement.type) {
    case 'authenticated':
      return context.user
        ? { granted: true }
        : { granted: false, reason: 'Authentication required' };

    case 'permission': {
      if (!context.user) {
        return { granted: false, reason: 'Authentication required' };
      }
      if (!storage) {
        throw new Error('Access control storage not initialized');
      }
      // Admin bypass for permission checks
      const isAdmin = await hasAdminPermission(context.user.id);
      if (isAdmin) {
        return { granted: true };
      }
      const hasPermission = await storage.hasPermission(context.user.id, requirement.key);
      return hasPermission
        ? { granted: true }
        : { granted: false, reason: `Missing permission: ${requirement.key}` };
    }

    case 'anyPermission': {
      if (!context.user) {
        return { granted: false, reason: 'Authentication required' };
      }
      if (!storage) {
        throw new Error('Access control storage not initialized');
      }
      // Admin bypass for permission checks
      const isAdmin = await hasAdminPermission(context.user.id);
      if (isAdmin) {
        return { granted: true };
      }
      for (const key of requirement.keys) {
        const hasPermission = await storage.hasPermission(context.user.id, key);
        if (hasPermission) {
          return { granted: true };
        }
      }
      return { granted: false, reason: `Missing any of permissions: ${requirement.keys.join(', ')}` };
    }

    case 'allPermissions': {
      if (!context.user) {
        return { granted: false, reason: 'Authentication required' };
      }
      if (!storage) {
        throw new Error('Access control storage not initialized');
      }
      // Admin bypass for permission checks
      const isAdmin = await hasAdminPermission(context.user.id);
      if (isAdmin) {
        return { granted: true };
      }
      for (const key of requirement.keys) {
        const hasPermission = await storage.hasPermission(context.user.id, key);
        if (!hasPermission) {
          return { granted: false, reason: `Missing permission: ${key}` };
        }
      }
      return { granted: true };
    }

    case 'component': {
      // Import dynamically to avoid circular dependency
      const { isComponentEnabled } = await import('./modules/components');
      const enabled = await isComponentEnabled(requirement.componentId);
      console.log(`[ACCESS CONTROL] Component check for '${requirement.componentId}': enabled=${enabled}`);
      return enabled
        ? { granted: true }
        : { granted: false, reason: `Component '${requirement.componentId}' is not enabled` };
    }

    case 'ownership': {
      if (!context.user) {
        return { granted: false, reason: 'Authentication required' };
      }
      // For now, ownership checks are not implemented
      // This would require fetching the resource and checking ownership
      return { granted: false, reason: 'Ownership check not implemented' };
    }

    case 'anyOf': {
      const failedReasons: string[] = [];
      for (const option of requirement.options) {
        const result = await evaluateRequirement(option, context);
        if (result.granted) {
          return { granted: true };
        }
        // Collect failure reasons
        const optionDesc = getRequirementDescription(option);
        failedReasons.push(`${optionDesc}${result.reason ? ': ' + result.reason : ''}`);
      }
      return { 
        granted: false, 
        reason: `None of the required conditions met. Failed: ${failedReasons.join('; ')}`
      };
    }

    case 'allOf': {
      for (const option of requirement.options) {
        const result = await evaluateRequirement(option, context);
        if (!result.granted) {
          const optionDesc = getRequirementDescription(option);
          return {
            granted: false,
            reason: `${optionDesc}${result.reason ? ': ' + result.reason : ''}`
          };
        }
      }
      return { granted: true };
    }

    case 'custom': {
      const granted = await requirement.check(context);
      return granted
        ? { granted: true }
        : { granted: false, reason: requirement.reason || 'Custom check failed' };
    }

    default:
      return { granted: false, reason: 'Unknown requirement type' };
  }
}

/**
 * Evaluate an access policy against a context
 */
export async function evaluatePolicy(
  policy: AccessPolicy,
  context: AccessContext
): Promise<AccessResult> {
  // Check if user has admin permission
  let isAdmin = false;
  if (context.user) {
    isAdmin = await hasAdminPermission(context.user.id);
  }

  // Evaluate all requirements (implicit AND)
  for (const requirement of policy.requirements) {
    // Component requirements apply to everyone, including admins
    // All other requirements are bypassed by admin permission
    if (isAdmin && requirement.type !== 'component') {
      continue; // Skip this requirement for admins
    }
    
    const result = await evaluateRequirement(requirement, context);
    if (!result.granted) {
      return result;
    }
  }

  return { granted: true };
}

/**
 * Evaluate a policy and return detailed requirement results
 */
export async function evaluatePolicyDetailed(
  policy: AccessPolicy,
  context: AccessContext
): Promise<DetailedPolicyResult> {
  const requirements: RequirementEvaluation[] = [];
  let allowed = true;
  let adminBypass = false;

  // Check if user has admin permission
  let isAdmin = false;
  if (context.user) {
    isAdmin = await hasAdminPermission(context.user.id);
    if (isAdmin) {
      adminBypass = true;
    }
  }

  // Evaluate each requirement
  for (const requirement of policy.requirements) {
    // Component requirements apply to everyone, including admins
    // All other requirements are bypassed by admin permission
    if (isAdmin && requirement.type !== 'component') {
      requirements.push({
        type: requirement.type,
        description: getRequirementDescription(requirement),
        status: 'skipped',
        reason: 'Admin bypass - user has admin permission',
      });
      continue;
    }

    const result = await evaluateRequirement(requirement, context);
    const evaluation: RequirementEvaluation = {
      type: requirement.type,
      description: getRequirementDescription(requirement),
      status: result.granted ? 'passed' : 'failed',
      reason: result.reason,
    };

    // Add specific details based on requirement type
    if (requirement.type === 'component') {
      evaluation.details = { componentId: requirement.componentId };
    } else if (requirement.type === 'permission') {
      evaluation.details = { permissionKey: requirement.key };
    } else if (requirement.type === 'anyPermission' || requirement.type === 'allPermissions') {
      evaluation.details = { permissionKeys: requirement.keys };
    }

    requirements.push(evaluation);

    if (!result.granted) {
      allowed = false;
      // Don't break - evaluate all requirements to show user what's missing
    }
  }

  return {
    policy: {
      name: policy.name,
      description: policy.description,
    },
    allowed,
    evaluatedAt: new Date().toISOString(),
    adminBypass,
    requirements,
  };
}

/**
 * Create an Express middleware that enforces an access policy
 */
export function requireAccess(policy: AccessPolicy) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await buildContext(req);
      const result = await evaluatePolicy(policy, context);

      if (!result.granted) {
        return res.status(403).json({
          message: result.reason || 'Access denied',
        });
      }

      next();
    } catch (error) {
      console.error('Access control error:', error);
      return res.status(500).json({
        message: 'Internal server error during access control',
      });
    }
  };
}

/**
 * Backward compatibility: wrap old requireAuth in new system
 */
export const requireAuth = requireAccess({
  name: 'Require Authentication',
  requirements: [{ type: 'authenticated' }],
});

/**
 * Backward compatibility: wrap old requirePermission in new system
 */
export function requirePermission(permissionKey: string) {
  return requireAccess({
    name: `Require Permission: ${permissionKey}`,
    requirements: [{ type: 'authenticated' }, { type: 'permission', key: permissionKey }],
  });
}

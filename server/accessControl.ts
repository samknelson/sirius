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
 * Storage interface for access control
 */
export interface AccessControlStorage {
  getUserPermissions(userId: string): Promise<string[]>;
  hasPermission(userId: string, permissionKey: string): Promise<boolean>;
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
 */
export function buildContext(req: Request): AccessContext {
  return {
    user: (req as any).user || null,
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
 * Evaluate a single access requirement
 */
async function evaluateRequirement(
  requirement: AccessRequirement,
  context: AccessContext
): Promise<AccessResult> {
  // Admin bypass: users with "admin" permission have access to everything
  if (context.user) {
    const isAdmin = await hasAdminPermission(context.user.id);
    if (isAdmin) {
      return { granted: true };
    }
  }

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
      for (const key of requirement.keys) {
        const hasPermission = await storage.hasPermission(context.user.id, key);
        if (!hasPermission) {
          return { granted: false, reason: `Missing permission: ${key}` };
        }
      }
      return { granted: true };
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
      for (const option of requirement.options) {
        const result = await evaluateRequirement(option, context);
        if (result.granted) {
          return { granted: true };
        }
      }
      return { granted: false, reason: 'None of the required conditions met' };
    }

    case 'allOf': {
      for (const option of requirement.options) {
        const result = await evaluateRequirement(option, context);
        if (!result.granted) {
          return result;
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
  // Short-circuit: admin permission bypasses all checks
  if (context.user) {
    const isAdmin = await hasAdminPermission(context.user.id);
    if (isAdmin) {
      return { granted: true };
    }
  }

  // Evaluate all requirements (implicit AND)
  for (const requirement of policy.requirements) {
    const result = await evaluateRequirement(requirement, context);
    if (!result.granted) {
      return result;
    }
  }

  return { granted: true };
}

/**
 * Create an Express middleware that enforces an access policy
 */
export function requireAccess(policy: AccessPolicy) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = buildContext(req);
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

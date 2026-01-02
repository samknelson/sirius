import { Request, Response, NextFunction } from 'express';
import type { User } from '@shared/schema';
import { accessPolicyRegistry, AccessPolicy } from '@shared/accessPolicies';
import { evaluatePolicy, AccessControlStorage } from './services/access-policy-evaluator';

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

let storage: AccessControlStorage | null = null;
let componentChecker: ((componentId: string) => Promise<boolean>) | null = null;
let fullStorage: any = null;

/**
 * Initialize the access control module with a storage implementation
 */
export function initAccessControl(
  storageImpl: AccessControlStorage,
  fullStorageImpl: any,
  componentCheckerImpl: (componentId: string) => Promise<boolean>
) {
  storage = storageImpl;
  fullStorage = fullStorageImpl;
  componentChecker = componentCheckerImpl;
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
 * Access result type
 */
export interface AccessResult {
  granted: boolean;
  reason?: string;
}

/**
 * Check access using the unified policy evaluator
 * 
 * @param policyId - The ID of the policy to evaluate
 * @param user - The authenticated user (null if not authenticated)
 * @param entityId - Optional entity ID for entity-level checks
 */
export async function checkAccess(
  policyId: string,
  user: User | null,
  entityId?: string
): Promise<AccessResult> {
  if (!storage || !componentChecker || !fullStorage) {
    throw new Error('Access control not initialized');
  }

  const result = await evaluatePolicy(
    user,
    policyId,
    fullStorage,
    storage,
    componentChecker,
    entityId
  );

  return {
    granted: result.granted,
    reason: result.reason,
  };
}

/**
 * Create an Express middleware that enforces an access policy by ID
 * 
 * @param policyId - The ID of the policy to enforce
 * @param getEntityId - Optional function to extract entity ID from request for entity-level checks (can be sync or async)
 */
export function requireAccess(
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!storage || !componentChecker || !fullStorage) {
        throw new Error('Access control not initialized');
      }

      const context = await buildContext(req);
      const entityId = await Promise.resolve(getEntityId?.(req));

      const result = await evaluatePolicy(
        context.user,
        policyId,
        fullStorage,
        storage,
        componentChecker,
        entityId
      );

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
 * Backward compatibility: wrap authentication check in new system
 */
export const requireAuth = requireAccess('authenticated');

/**
 * Backward compatibility: wrap permission check in new system
 * This creates an inline policy - prefer using defined policies instead
 */
export function requirePermission(permissionKey: string) {
  // For backward compatibility, we check if a policy with this permission exists
  // Otherwise fall back to requiring the 'authenticated' policy + manual check
  const policyId = permissionKey; // Policy ID matches permission key
  if (accessPolicyRegistry.has(policyId)) {
    return requireAccess(policyId);
  }
  
  // Fallback: create a dynamic check (not recommended - define policies explicitly)
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!storage) {
        throw new Error('Access control not initialized');
      }

      const context = await buildContext(req);
      
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Check admin bypass
      const isAdmin = await storage.hasPermission(context.user.id, 'admin');
      if (isAdmin) {
        return next();
      }

      // Check specific permission
      const hasPermission = await storage.hasPermission(context.user.id, permissionKey);
      if (!hasPermission) {
        return res.status(403).json({ message: `Missing permission: ${permissionKey}` });
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
 * Re-export types and utilities for consumers
 */
export type { AccessPolicy, AccessControlStorage };
export { accessPolicyRegistry };

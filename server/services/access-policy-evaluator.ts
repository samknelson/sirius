/**
 * Access Policy Evaluator
 * 
 * Unified access control module providing:
 * - Policy evaluation engine using modular policies from shared/access-policies/
 * - Express middleware for route protection (requireAccess, requireAuth, requirePermission)
 * - Request context building with masquerade support
 * - LRU caching for entity-level access checks
 */

import { Request, Response, NextFunction } from 'express';
import { AccessResult, buildCacheKey, accessPolicyRegistry, AccessPolicy, AccessRule, AccessCondition } from '@shared/accessPolicies';
import { getPolicy as getModularPolicy } from '@shared/access-policies';
import { createPolicyContext } from './policy-context';
import { logger } from '../logger';
import type { User } from '@shared/schema';

/**
 * Entity loader function type
 * Loads an entity record by its ID for attribute evaluation
 */
export type EntityLoader = (entityId: string, storage: any) => Promise<Record<string, any> | null>;

/**
 * Registry of entity loaders by entity type
 */
const entityLoaders = new Map<string, EntityLoader>();

/**
 * Register an entity loader for a specific entity type
 * Used for attribute-based access checks
 */
export function registerEntityLoader(entityType: string, loader: EntityLoader): void {
  if (entityLoaders.has(entityType)) {
    logger.warn(`Entity loader for '${entityType}' already registered, overwriting`, { service: SERVICE });
  }
  entityLoaders.set(entityType, loader);
}

/**
 * Get the entity loader for a specific entity type
 */
export function getEntityLoader(entityType: string): EntityLoader | undefined {
  return entityLoaders.get(entityType);
}

/**
 * Clear all entity loaders (for testing)
 */
export function clearEntityLoaders(): void {
  entityLoaders.clear();
}

const SERVICE = 'access-policy-evaluator';

/**
 * LRU Cache for access results
 * Key: userId:policyId or userId:policyId:entityId
 * Value: { granted: boolean, evaluatedAt: number }
 */
class AccessCache {
  private cache = new Map<string, AccessResult>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 10000, ttlMs = 5 * 60 * 1000) { // 5 minute TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): AccessResult | undefined {
    const result = this.cache.get(key);
    if (!result) return undefined;
    
    // Check if expired
    if (Date.now() - result.evaluatedAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, result);
    
    return result;
  }

  set(key: string, result: AccessResult): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  invalidate(pattern: { userId?: string; policyId?: string; entityId?: string }): number {
    let count = 0;
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length < 2) continue;
      
      const [userId, policyId, entityId] = parts;
      
      const match = 
        (!pattern.userId || userId === pattern.userId) &&
        (!pattern.policyId || policyId === pattern.policyId) &&
        (!pattern.entityId || !entityId || entityId === pattern.entityId);
      
      if (match) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs };
  }
}

// Singleton cache instance
const accessCache = new AccessCache();

/**
 * Storage interface for access control
 */
export interface AccessControlStorage {
  getUserPermissions(userId: string): Promise<string[]>;
  hasPermission(userId: string, permissionKey: string): Promise<boolean>;
  getUserByReplitId(replitUserId: string): Promise<User | undefined>;
  getUser(userId: string): Promise<User | undefined>;
}

/**
 * Component flag checker function type
 */
type ComponentChecker = (componentId: string) => Promise<boolean>;

// Module state - initialized via initAccessControl()
let storage: AccessControlStorage | null = null;
let componentChecker: ComponentChecker | null = null;
let fullStorage: any = null;

/**
 * Initialize the access control module with storage and component checker implementations
 */
export function initAccessControl(
  storageImpl: AccessControlStorage,
  fullStorageImpl: any,
  componentCheckerImpl: ComponentChecker
) {
  storage = storageImpl;
  fullStorage = fullStorageImpl;
  componentChecker = componentCheckerImpl;
}

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
 * Check access using the unified policy evaluator
 * 
 * @param policyId - The ID of the policy to evaluate
 * @param user - The authenticated user (null if not authenticated)
 * @param entityId - Optional entity ID for entity-level checks
 * @param entityData - Optional entity data for policies that need additional context
 */
export async function checkAccess(
  policyId: string,
  user: User | null,
  entityId?: string,
  entityData?: Record<string, any>
): Promise<{ granted: boolean; reason?: string }> {
  if (!storage || !componentChecker || !fullStorage) {
    throw new Error('Access control not initialized');
  }

  const result = await evaluatePolicy(
    user,
    policyId,
    fullStorage,
    storage,
    componentChecker,
    entityId,
    undefined, // entityType - use policy's default
    { entityData }
  );

  return {
    granted: result.granted,
    reason: result.reason,
  };
}

/**
 * Check access inline within a route handler, using the request context
 * 
 * @param req - The Express request object
 * @param policyId - The ID of the policy to evaluate
 * @param entityId - Optional entity ID for entity-level checks
 * @param entityData - Optional entity data for virtual entity checks
 */
export async function checkAccessInline(
  req: Request,
  policyId: string,
  entityId?: string,
  entityData?: Record<string, any>
): Promise<{ granted: boolean; reason?: string }> {
  if (!storage || !componentChecker || !fullStorage) {
    throw new Error('Access control not initialized');
  }

  const context = await buildContext(req);

  const result = await evaluatePolicy(
    context.user,
    policyId,
    fullStorage,
    storage,
    componentChecker,
    entityId,
    undefined, // entityType - use policy's default
    { entityData }
  );

  return {
    granted: result.granted,
    reason: result.reason,
  };
}

/**
 * Options for requireAccess when using an options object
 */
export interface RequireAccessOptions {
  /** Function to extract entity ID from request */
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>;
  /** Function to extract entity data directly from request (for create operations) */
  getEntityData?: (req: Request) => Record<string, any> | undefined | Promise<Record<string, any> | undefined>;
}

/**
 * Create an Express middleware that enforces an access policy by ID
 * 
 * @param policyId - The ID of the policy to enforce
 * @param getEntityIdOrOptions - Either a function to extract entity ID, or an options object
 */
export function requireAccess(
  policyId: string,
  getEntityIdOrOptions?: ((req: Request) => string | undefined | Promise<string | undefined>) | RequireAccessOptions
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!storage || !componentChecker || !fullStorage) {
        throw new Error('Access control not initialized');
      }

      const context = await buildContext(req);
      
      // Handle both function and options object forms
      let entityId: string | undefined;
      let entityData: Record<string, any> | undefined;
      
      if (typeof getEntityIdOrOptions === 'function') {
        entityId = await Promise.resolve(getEntityIdOrOptions(req));
      } else if (getEntityIdOrOptions) {
        entityId = await Promise.resolve(getEntityIdOrOptions.getEntityId?.(req));
        entityData = await Promise.resolve(getEntityIdOrOptions.getEntityData?.(req));
      }

      const result = await evaluatePolicy(
        context.user,
        policyId,
        fullStorage,
        storage,
        componentChecker,
        entityId,
        undefined, // entityType - use policy's default
        { entityData }
      );

      if (!result.granted) {
        return res.status(403).json({
          message: result.reason || 'Access denied',
          error: 'ACCESS_DENIED',
          policy: policyId,
          entityId: entityId || null,
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
 * Get the component checker function
 */
export function getComponentChecker(): ComponentChecker | null {
  return componentChecker;
}

/**
 * Get the full storage instance
 */
export function getFullStorage(): any | null {
  return fullStorage;
}

/**
 * Get the access control storage instance
 */
export function getAccessStorage(): AccessControlStorage | null {
  return storage;
}

// Re-export types for consumers
export type { AccessPolicy };

/**
 * Evaluate a single AccessCondition
 * Returns { passed: boolean, reason: string }
 */
async function evaluateCondition(
  condition: AccessCondition,
  ctx: ReturnType<typeof createPolicyContext>,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker
): Promise<{ passed: boolean; reason: string }> {
  // Check authenticated requirement
  if (condition.authenticated === true) {
    if (!ctx.user) {
      return { passed: false, reason: 'Authentication required' };
    }
  }
  
  // Check single permission requirement
  if (condition.permission) {
    const hasPermission = await ctx.hasPermission(condition.permission);
    if (!hasPermission) {
      return { passed: false, reason: `Missing permission: ${condition.permission}` };
    }
  }
  
  // Check any permission (OR)
  if (condition.anyPermission && condition.anyPermission.length > 0) {
    let hasAny = false;
    for (const perm of condition.anyPermission) {
      if (await ctx.hasPermission(perm)) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) {
      return { passed: false, reason: `Missing any of permissions: ${condition.anyPermission.join(', ')}` };
    }
  }
  
  // Check all permissions (AND)
  if (condition.allPermissions && condition.allPermissions.length > 0) {
    for (const perm of condition.allPermissions) {
      if (!(await ctx.hasPermission(perm))) {
        return { passed: false, reason: `Missing permission: ${perm}` };
      }
    }
  }
  
  // Check component requirement
  if (condition.component) {
    const componentEnabled = await checkComponent(condition.component);
    if (!componentEnabled) {
      return { passed: false, reason: `Component not enabled: ${condition.component}` };
    }
  }
  
  // Check delegated policy
  if (condition.policy) {
    const policyPassed = await ctx.checkPolicy(condition.policy, ctx.entityId);
    if (!policyPassed) {
      return { passed: false, reason: `Delegated policy failed: ${condition.policy}` };
    }
  }
  
  return { passed: true, reason: 'Condition passed' };
}

/**
 * Evaluate an AccessRule (which can be a condition, OR group, or AND group)
 */
async function evaluateRule(
  rule: AccessRule,
  ctx: ReturnType<typeof createPolicyContext>,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker
): Promise<{ passed: boolean; reason: string }> {
  // Check if it's an OR group
  if ('any' in rule) {
    for (const condition of rule.any) {
      const result = await evaluateCondition(condition, ctx, accessStorage, checkComponent);
      if (result.passed) {
        return { passed: true, reason: 'Any condition passed' };
      }
    }
    return { passed: false, reason: 'No conditions in any group passed' };
  }
  
  // Check if it's an AND group
  if ('all' in rule) {
    for (const condition of rule.all) {
      const result = await evaluateCondition(condition, ctx, accessStorage, checkComponent);
      if (!result.passed) {
        return result;
      }
    }
    return { passed: true, reason: 'All conditions passed' };
  }
  
  // It's a simple condition
  return evaluateCondition(rule as AccessCondition, ctx, accessStorage, checkComponent);
}

/**
 * Evaluate declarative rules for policies without custom evaluate functions.
 * Rules are evaluated with OR logic (any rule passing grants access).
 * Within each rule, all conditions must pass (AND logic).
 */
async function evaluateDeclarativeRules(
  rules: AccessRule[],
  ctx: ReturnType<typeof createPolicyContext>,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker
): Promise<{ granted: boolean; reason: string }> {
  let lastDenialReason = 'No rules matched';
  
  for (const rule of rules) {
    const result = await evaluateRule(rule, ctx, accessStorage, checkComponent);
    if (result.passed) {
      return { granted: true, reason: result.reason };
    }
    lastDenialReason = result.reason;
  }
  
  return { granted: false, reason: lastDenialReason };
}

/**
 * Evaluate a modular policy (from shared/access-policies/)
 * 
 * Modular policies have their own evaluate functions that receive a PolicyContext
 * with injected utilities for permission checking, entity loading, and policy delegation.
 */
async function evaluateModularPolicy(
  user: User | null,
  policyId: string,
  storage: any,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker,
  entityId?: string,
  options: { skipCache?: boolean; entityData?: Record<string, any>; evaluationStack?: Set<string> } = {}
): Promise<AccessResult> {
  const policy = getModularPolicy(policyId);
  if (!policy) {
    return {
      granted: false,
      reason: `Modular policy not found: ${policyId}`,
      evaluatedAt: Date.now(),
    };
  }
  
  // Check cache (same logic as declarative policies)
  // Skip cache if: options.skipCache, entityData provided, or policy declares skipCache
  const shouldUseCache = !options.skipCache && !options.entityData && !policy.skipCache;
  const cacheKey = shouldUseCache && user ? buildCacheKey(user.id, policyId, entityId) : null;
  if (cacheKey) {
    const cached = accessCache.get(cacheKey);
    if (cached) {
      logger.debug(`Modular policy cache hit`, { 
        service: SERVICE, 
        userId: user?.id, 
        policyId, 
        entityId,
        granted: cached.granted 
      });
      return cached;
    }
  }
  
  // Require authentication for modular policies unless explicitly public
  if (!user) {
    return {
      granted: false,
      reason: 'Authentication required',
      evaluatedAt: Date.now(),
    };
  }
  
  // Check component requirement for ALL users (feature flag must be enabled)
  if (policy.component) {
    const componentEnabled = await checkComponent(policy.component);
    if (!componentEnabled) {
      const result: AccessResult = {
        granted: false,
        reason: `Component ${policy.component} not enabled`,
        evaluatedAt: Date.now(),
      };
      if (cacheKey) accessCache.set(cacheKey, result);
      return result;
    }
  }
  
  // Check if user is admin (bypass permission/entity checks after component check)
  // Skip admin bypass if the policy explicitly requires all users to go through evaluation
  const isAdmin = await accessStorage.hasPermission(user.id, 'admin');
  if (isAdmin && !policy.noAdminBypass) {
    const result: AccessResult = {
      granted: true,
      reason: 'Admin bypass',
      evaluatedAt: Date.now(),
    };
    if (cacheKey) accessCache.set(cacheKey, result);
    return result;
  }
  
  // Track evaluation stack for recursion protection
  const evaluationStack = options.evaluationStack || new Set<string>();
  const evaluationKey = `${policyId}:${entityId || ''}:${JSON.stringify(options.entityData || {})}`;
  
  if (evaluationStack.has(evaluationKey)) {
    logger.warn(`Policy evaluation recursion detected`, { 
      service: SERVICE, 
      policyId, 
      entityId,
      evaluationKey 
    });
    return {
      granted: false,
      reason: 'Policy evaluation recursion detected',
      evaluatedAt: Date.now(),
    };
  }
  
  evaluationStack.add(evaluationKey);
  
  // Create policy context with injected utilities
  const ctx = createPolicyContext({
    user,
    entityId,
    entityData: options.entityData,
    storage,
    accessStorage,
    checkComponent,
    evaluatePolicy: async (delegatePolicyId: string, delegateEntityId?: string, delegateEntityData?: Record<string, any>) => {
      const result = await evaluatePolicy(
        user,
        delegatePolicyId,
        storage,
        accessStorage,
        checkComponent,
        delegateEntityId,
        undefined,
        { 
          entityData: delegateEntityData,
          evaluationStack, // Pass the stack for recursion detection
        }
      );
      return result.granted;
    },
  });
  
  // Execute the policy's evaluate function, or fallback to declarative rules
  try {
    let policyResult: { granted: boolean; reason: string };
    
    if (policy.evaluate) {
      // Use custom evaluate function
      const evalResult = await policy.evaluate(ctx);
      policyResult = { 
        granted: evalResult.granted, 
        reason: evalResult.reason || (evalResult.granted ? 'Access granted' : 'Access denied')
      };
    } else if (policy.rules && policy.rules.length > 0) {
      // Fallback: evaluate declarative rules (OR between rules, AND within each rule)
      policyResult = await evaluateDeclarativeRules(policy.rules, ctx, accessStorage, checkComponent);
    } else {
      // No evaluate function and no rules - deny by default
      return {
        granted: false,
        reason: `Policy ${policyId} has no evaluate function or rules`,
        evaluatedAt: Date.now(),
      };
    }
    const result: AccessResult = {
      granted: policyResult.granted,
      reason: policyResult.reason,
      evaluatedAt: Date.now(),
    };
    
    if (cacheKey) accessCache.set(cacheKey, result);
    
    logger.debug(`Modular policy evaluated`, { 
      service: SERVICE, 
      userId: user.id, 
      policyId, 
      entityId,
      granted: result.granted,
      reason: result.reason
    });
    
    return result;
  } catch (error) {
    logger.error(`Error evaluating modular policy ${policyId}`, { 
      service: SERVICE, 
      error: (error as Error).message,
      userId: user.id,
      entityId
    });
    return {
      granted: false,
      reason: `Policy evaluation error: ${(error as Error).message}`,
      evaluatedAt: Date.now(),
    };
  } finally {
    // Clean up evaluation stack to avoid false recursion detection on subsequent calls
    evaluationStack.delete(evaluationKey);
  }
}

/**
 * Evaluate an access policy
 * 
 * All policies are now modular (defined in shared/access-policies/).
 * 
 * @param user - The authenticated user
 * @param policyId - The policy to evaluate
 * @param storage - Storage interface for data access
 * @param accessStorage - Access control storage for permissions
 * @param checkComponent - Function to check component flags
 * @param entityId - Entity ID (required for entity-level policies)
 * @param entityType - Override entity type (optional, unused but kept for API compatibility)
 * @param options - Evaluation options including entityData for virtual entities
 */
export async function evaluatePolicy(
  user: User | null,
  policyId: string,
  storage: any,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker,
  entityId?: string,
  entityType?: string,
  options: { skipCache?: boolean; entityData?: Record<string, any>; evaluationStack?: Set<string> } = {}
): Promise<AccessResult> {
  return evaluateModularPolicy(
    user, 
    policyId, 
    storage, 
    accessStorage, 
    checkComponent, 
    entityId, 
    options
  );
}

/**
 * Batch evaluate access for multiple entities
 */
export async function evaluatePolicyBatch(
  user: User,
  policyId: string,
  entityIds: string[],
  storage: any,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker
): Promise<Map<string, AccessResult>> {
  const results = new Map<string, AccessResult>();
  
  await Promise.all(
    entityIds.map(async (entityId) => {
      const result = await evaluatePolicy(
        user, 
        policyId, 
        storage, 
        accessStorage, 
        checkComponent, 
        entityId
      );
      results.set(entityId, result);
    })
  );
  
  return results;
}

/**
 * Invalidate cache entries
 */
export function invalidateAccessCache(pattern: {
  userId?: string;
  policyId?: string;
  entityId?: string;
}): number {
  const count = accessCache.invalidate(pattern);
  if (count > 0) {
    logger.debug(`Invalidated ${count} access cache entries`, { 
      service: SERVICE, 
      pattern 
    });
  }
  return count;
}

/**
 * Clear all cache entries
 */
export function clearAccessCache(): void {
  accessCache.clear();
  logger.info(`Cleared access cache`, { service: SERVICE });
}

/**
 * Get cache statistics
 */
export function getAccessCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return accessCache.stats();
}

/**
 * Access Policy Evaluator
 * 
 * Single evaluation engine for access checks using modular policies
 * defined in shared/access-policies/ with custom evaluate functions.
 * Supports caching for entity-level checks.
 */

import { AccessResult, buildCacheKey } from '@shared/accessPolicies';
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
  const shouldUseCache = !options.skipCache && !options.entityData;
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
  const isAdmin = await accessStorage.hasPermission(user.id, 'admin');
  if (isAdmin) {
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
  
  // Execute the policy's evaluate function
  try {
    if (!policy.evaluate) {
      return {
        granted: false,
        reason: `Policy ${policyId} has no evaluate function`,
        evaluatedAt: Date.now(),
      };
    }
    const policyResult = await policy.evaluate(ctx);
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

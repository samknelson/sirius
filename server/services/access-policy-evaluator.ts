/**
 * Unified Access Policy Evaluator
 * 
 * Single evaluation engine for both route-level and entity-level access checks.
 * Supports caching for entity-level checks.
 */

import { 
  AccessPolicy, 
  AccessCondition, 
  AccessRule,
  AccessResult,
  LinkagePredicate,
  PolicyEntityType,
  buildCacheKey,
  accessPolicyRegistry,
  policyRequiresEntityContext,
} from '@shared/accessPolicies';
import { logger } from '../logger';
import type { User } from '@shared/schema';

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
 * Linkage resolver context
 */
interface LinkageContext {
  userId: string;
  userEmail: string;
  entityType: PolicyEntityType;
  entityId: string;
}

/**
 * Linkage resolver function type
 */
type LinkageResolver = (ctx: LinkageContext, storage: any) => Promise<boolean>;

/**
 * Registry of linkage resolvers
 */
const linkageResolvers: Record<LinkagePredicate, LinkageResolver> = {
  ownsWorker: async (ctx, storage) => {
    if (ctx.entityType !== 'worker') return false;
    
    // Find the user's contact record
    const userContact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!userContact) return false;
    
    // Find the worker record that the user owns (via their contact ID)
    const userWorker = await storage.workers.getWorkerByContactId?.(userContact.id);
    if (!userWorker) return false;
    
    // Check if the entity worker ID matches the user's worker ID
    // This is stable even after email changes since it uses contact ID linkage
    return userWorker.id === ctx.entityId;
  },

  workerBenefitProvider: async (ctx, storage) => {
    if (ctx.entityType !== 'worker') return false;
    
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(contact.id);
    if (!providerContacts || providerContacts.length === 0) return false;
    
    const workerBenefits = await storage.trustWmb?.getActiveByWorker?.(ctx.entityId);
    if (!workerBenefits || workerBenefits.length === 0) return false;
    
    const userProviderIds = providerContacts.map((pc: any) => pc.providerId);
    return workerBenefits.some((wb: any) => userProviderIds.includes(wb.providerId));
  },

  workerEmploymentHistory: async (ctx, storage) => {
    if (ctx.entityType !== 'employer') return false;
    
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    const userWorker = await storage.workers.getWorkerByContactId?.(contact.id);
    if (!userWorker) return false;
    
    const employments = await storage.workerEmployments?.getByWorker?.(userWorker.id);
    if (!employments) return false;
    
    return employments.some((emp: any) => emp.employerId === ctx.entityId);
  },

  employerAssociation: async (ctx, storage) => {
    if (ctx.entityType !== 'employer') return false;
    
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    const employerContacts = await storage.employerContacts.listByEmployer(ctx.entityId);
    return employerContacts.some((ec: any) => ec.contactId === contact.id);
  },

  providerAssociation: async (ctx, storage) => {
    if (ctx.entityType !== 'provider') return false;
    
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(contact.id);
    if (!providerContacts) return false;
    
    return providerContacts.some((pc: any) => pc.providerId === ctx.entityId);
  },

  fileUploader: async (ctx, storage) => {
    if (ctx.entityType !== 'file') return false;
    
    const file = await storage.fileMetadata?.getFileMetadata?.(ctx.entityId);
    if (!file) return false;
    
    return file.uploadedByUserId === ctx.userId;
  },

  contactWorkerOwner: async (ctx, storage) => {
    if (ctx.entityType !== 'contact') return false;
    
    // Find the user's contact record
    const userContact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!userContact) return false;
    
    // Find the worker record that the user owns (via their contact)
    const userWorker = await storage.workers.getWorkerByContactId?.(userContact.id);
    if (!userWorker) return false;
    
    // Check if the entity contact ID matches the user's worker's contact ID
    // This ensures the user can only edit contacts associated with their own worker record
    return userWorker.contactId === ctx.entityId;
  },

  contactWorkerProvider: async (ctx, storage) => {
    if (ctx.entityType !== 'contact') return false;
    
    // Find workers that use this contact
    const worker = await storage.workers.getWorkerByContactId?.(ctx.entityId);
    if (!worker) return false;
    
    // Check if user is a provider for this worker's benefits
    const userContact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!userContact) return false;
    
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(userContact.id);
    if (!providerContacts || providerContacts.length === 0) return false;
    
    const workerBenefits = await storage.trustWmb?.getActiveByWorker?.(worker.id);
    if (!workerBenefits || workerBenefits.length === 0) return false;
    
    const userProviderIds = providerContacts.map((pc: any) => pc.providerId);
    return workerBenefits.some((wb: any) => userProviderIds.includes(wb.providerId));
  },

  contactEmployerAssoc: async (ctx, storage) => {
    if (ctx.entityType !== 'contact') return false;
    
    // Find employer contacts that use this contact
    const employerContacts = await storage.employerContacts.listByContactId?.(ctx.entityId);
    if (!employerContacts || employerContacts.length === 0) return false;
    
    // Check if user is associated with any of these employers
    const userContact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!userContact) return false;
    
    // Get employers that the user is a contact for
    const userEmployerContacts = await storage.employerContacts.listByContactId?.(userContact.id);
    if (!userEmployerContacts || userEmployerContacts.length === 0) return false;
    
    const userEmployerIds = userEmployerContacts.map((ec: any) => ec.employerId);
    return employerContacts.some((ec: any) => userEmployerIds.includes(ec.employerId));
  },

  contactProviderAssoc: async (ctx, storage) => {
    if (ctx.entityType !== 'contact') return false;
    
    // Find trust provider contacts that use this contact
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(ctx.entityId);
    if (!providerContacts || providerContacts.length === 0) return false;
    
    // Check if user is associated with any of these providers
    const userContact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!userContact) return false;
    
    // Get providers that the user is a contact for
    const userProviderContacts = await storage.trustProviderContacts?.getByContactId?.(userContact.id);
    if (!userProviderContacts || userProviderContacts.length === 0) return false;
    
    const userProviderIds = userProviderContacts.map((pc: any) => pc.providerId);
    return providerContacts.some((pc: any) => userProviderIds.includes(pc.providerId));
  },
};

/**
 * Mapping from linkage predicates to their required entity types
 * Used to infer entityType for route-level policies that use linkages
 */
const linkageEntityTypes: Record<LinkagePredicate, PolicyEntityType> = {
  ownsWorker: 'worker',
  workerBenefitProvider: 'worker',
  workerEmploymentHistory: 'employer',
  employerAssociation: 'employer',
  providerAssociation: 'provider',
  fileUploader: 'file',
  contactWorkerOwner: 'contact',
  contactWorkerProvider: 'contact',
  contactEmployerAssoc: 'contact',
  contactProviderAssoc: 'contact',
};

/**
 * Recursively find a linkage predicate in a rule
 */
function findLinkageInRule(rule: AccessRule): LinkagePredicate | undefined {
  // Check for 'any' composition - recurse into each condition
  if ('any' in rule) {
    for (const condition of rule.any) {
      const found = findLinkageInRule(condition as AccessRule);
      if (found) return found;
    }
  }
  // Check for 'all' composition - recurse into each condition
  else if ('all' in rule) {
    for (const condition of rule.all) {
      const found = findLinkageInRule(condition as AccessRule);
      if (found) return found;
    }
  }
  // Simple condition with linkage
  else if ((rule as AccessCondition).linkage) {
    return (rule as AccessCondition).linkage;
  }
  return undefined;
}

/**
 * Infer entity type from policy rules that have linkage requirements
 * Recursively traverses nested any/all compositions
 * Returns the first linkage's entity type found, or undefined
 */
function inferEntityTypeFromRules(rules: AccessRule[]): PolicyEntityType | undefined {
  for (const rule of rules) {
    const linkage = findLinkageInRule(rule);
    if (linkage) {
      return linkageEntityTypes[linkage];
    }
  }
  return undefined;
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

/**
 * Component flag checker function type
 */
type ComponentChecker = (componentId: string) => Promise<boolean>;

/**
 * Evaluation context
 */
interface EvaluationContext {
  user: User;
  entityType?: PolicyEntityType;
  entityId?: string;
  storage: any;
  accessStorage: AccessControlStorage;
  checkComponent: ComponentChecker;
}

/**
 * Evaluate a single condition
 */
async function evaluateCondition(
  condition: AccessCondition,
  ctx: EvaluationContext
): Promise<{ passed: boolean; reason?: string }> {
  // Check authentication requirement
  if (condition.authenticated && !ctx.user) {
    return { passed: false, reason: 'Authentication required' };
  }

  // Check component requirement
  if (condition.component) {
    const enabled = await ctx.checkComponent(condition.component);
    if (!enabled) {
      return { passed: false, reason: `Component '${condition.component}' is not enabled` };
    }
  }

  // Check single permission
  if (condition.permission) {
    const hasPermission = await ctx.accessStorage.hasPermission(ctx.user.id, condition.permission);
    if (!hasPermission) {
      return { passed: false, reason: `Missing permission: ${condition.permission}` };
    }
  }

  // Check any permission (OR)
  if (condition.anyPermission && condition.anyPermission.length > 0) {
    let hasAny = false;
    for (const perm of condition.anyPermission) {
      if (await ctx.accessStorage.hasPermission(ctx.user.id, perm)) {
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
      if (!(await ctx.accessStorage.hasPermission(ctx.user.id, perm))) {
        return { passed: false, reason: `Missing permission: ${perm}` };
      }
    }
  }

  // Check linkage (requires entity context)
  if (condition.linkage) {
    if (!ctx.entityType || !ctx.entityId) {
      return { passed: false, reason: 'Linkage check requires entity context' };
    }

    const resolver = linkageResolvers[condition.linkage];
    if (!resolver) {
      logger.warn(`Unknown linkage predicate: ${condition.linkage}`, { service: SERVICE });
      return { passed: false, reason: `Unknown linkage predicate: ${condition.linkage}` };
    }

    const linkageCtx: LinkageContext = {
      userId: ctx.user.id,
      userEmail: ctx.user.email,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
    };

    const hasLinkage = await resolver(linkageCtx, ctx.storage);
    if (!hasLinkage) {
      return { passed: false, reason: 'Linkage check failed' };
    }
  }

  return { passed: true };
}

/**
 * Evaluate a rule (handles any/all compositions)
 */
async function evaluateRule(
  rule: AccessRule,
  ctx: EvaluationContext
): Promise<{ passed: boolean; reason?: string }> {
  // Check if it's an OR rule
  if ('any' in rule) {
    const reasons: string[] = [];
    for (const condition of rule.any) {
      const result = await evaluateCondition(condition, ctx);
      if (result.passed) {
        return { passed: true };
      }
      if (result.reason) reasons.push(result.reason);
    }
    return { passed: false, reason: reasons.join('; ') || 'No conditions met' };
  }

  // Check if it's an AND rule
  if ('all' in rule) {
    for (const condition of rule.all) {
      const result = await evaluateCondition(condition, ctx);
      if (!result.passed) {
        return result;
      }
    }
    return { passed: true };
  }

  // Simple condition
  return evaluateCondition(rule as AccessCondition, ctx);
}

/**
 * Evaluate an access policy
 * 
 * @param user - The authenticated user
 * @param policyId - The policy to evaluate
 * @param storage - Storage interface for data access
 * @param accessStorage - Access control storage for permissions
 * @param checkComponent - Function to check component flags
 * @param entityId - Entity ID (required for entity-level policies)
 * @param options - Evaluation options
 */
export async function evaluatePolicy(
  user: User | null,
  policyId: string,
  storage: any,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker,
  entityId?: string,
  options: { skipCache?: boolean } = {}
): Promise<AccessResult> {
  // Get policy
  const policy = accessPolicyRegistry.get(policyId);
  if (!policy) {
    return {
      granted: false,
      reason: `Unknown policy: ${policyId}`,
      evaluatedAt: Date.now(),
    };
  }

  // Check if policy requires entity context
  const requiresEntity = policyRequiresEntityContext(policy);
  if (requiresEntity && !entityId) {
    return {
      granted: false,
      reason: 'Policy requires entity context but no entity ID provided',
      evaluatedAt: Date.now(),
    };
  }

  // Check cache for entity-level checks
  const cacheKey = user ? buildCacheKey(user.id, policyId, entityId) : null;
  if (cacheKey && !options.skipCache) {
    const cached = accessCache.get(cacheKey);
    if (cached) {
      logger.debug(`Access cache hit`, { 
        service: SERVICE, 
        userId: user?.id, 
        policyId, 
        entityId,
        granted: cached.granted 
      });
      return cached;
    }
  }

  // Check authentication
  if (!user) {
    // Check if any rule has authenticated: false (public access)
    const hasPublicRule = policy.rules.some(rule => {
      if ('any' in rule || 'all' in rule) return false;
      return (rule as AccessCondition).authenticated === false;
    });
    
    if (!hasPublicRule) {
      return {
        granted: false,
        reason: 'Authentication required',
        evaluatedAt: Date.now(),
      };
    }
  }

  // Check if user is admin (bypass all checks except component and missing policy)
  let isAdmin = false;
  if (user) {
    isAdmin = await accessStorage.hasPermission(user.id, 'admin');
  }

  // Determine entityType - use policy's entityType, or infer from linkage rules
  const effectiveEntityType = policy.entityType || inferEntityTypeFromRules(policy.rules);
  
  // Build evaluation context
  const ctx: EvaluationContext = {
    user: user!,
    entityType: effectiveEntityType,
    entityId,
    storage,
    accessStorage,
    checkComponent,
  };

  // Evaluate rules (OR - any rule grants access)
  for (const rule of policy.rules) {
    // For admins, skip permission/linkage checks but still check components
    if (isAdmin) {
      // Check component requirements in the rule
      const hasComponentReq = checkRuleForComponent(rule);
      if (hasComponentReq) {
        const componentResult = await evaluateRuleComponentsOnly(rule, checkComponent);
        if (!componentResult.passed) {
          continue; // Try next rule
        }
      }
      // Rule passed for admin
      const result: AccessResult = {
        granted: true,
        reason: 'Admin bypass',
        evaluatedAt: Date.now(),
      };
      if (cacheKey) accessCache.set(cacheKey, result);
      return result;
    }

    const ruleResult = await evaluateRule(rule, ctx);
    if (ruleResult.passed) {
      const result: AccessResult = {
        granted: true,
        evaluatedAt: Date.now(),
      };
      if (cacheKey) accessCache.set(cacheKey, result);
      logger.debug(`Access granted`, { 
        service: SERVICE, 
        userId: user?.id, 
        policyId, 
        entityId 
      });
      return result;
    }
  }

  // No rules matched
  const result: AccessResult = {
    granted: false,
    reason: 'No matching access rules',
    evaluatedAt: Date.now(),
  };
  if (cacheKey) accessCache.set(cacheKey, result);
  logger.debug(`Access denied`, { 
    service: SERVICE, 
    userId: user?.id, 
    policyId, 
    entityId 
  });
  return result;
}

/**
 * Check if a rule has component requirements
 */
function checkRuleForComponent(rule: AccessRule): boolean {
  if ('any' in rule) {
    return rule.any.some(c => !!c.component);
  }
  if ('all' in rule) {
    return rule.all.some(c => !!c.component);
  }
  return !!(rule as AccessCondition).component;
}

/**
 * Evaluate only component requirements in a rule
 */
async function evaluateRuleComponentsOnly(
  rule: AccessRule,
  checkComponent: ComponentChecker
): Promise<{ passed: boolean; reason?: string }> {
  if ('any' in rule) {
    // For OR, any component-free condition or any passing component is enough
    for (const condition of rule.any) {
      if (!condition.component) return { passed: true };
      if (await checkComponent(condition.component)) return { passed: true };
    }
    return { passed: false, reason: 'No component requirements met' };
  }

  if ('all' in rule) {
    // For AND, all component conditions must pass
    for (const condition of rule.all) {
      if (condition.component) {
        if (!(await checkComponent(condition.component))) {
          return { passed: false, reason: `Component '${condition.component}' is not enabled` };
        }
      }
    }
    return { passed: true };
  }

  // Simple condition
  const condition = rule as AccessCondition;
  if (condition.component) {
    if (!(await checkComponent(condition.component))) {
      return { passed: false, reason: `Component '${condition.component}' is not enabled` };
    }
  }
  return { passed: true };
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

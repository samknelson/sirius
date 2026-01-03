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
  AttributePredicate,
  buildCacheKey,
  accessPolicyRegistry,
  policyRequiresEntityContext,
} from '@shared/accessPolicies';
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
    
    const worker = await storage.workers.getWorker(ctx.entityId);
    if (!worker) return false;
    
    const contact = await storage.contacts.getContact(worker.contactId);
    if (!contact?.email) return false;
    
    return ctx.userEmail.toLowerCase() === contact.email.toLowerCase();
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
    
    const file = await storage.files?.getById?.(ctx.entityId);
    if (!file) return false;
    
    return file.uploadedBy === ctx.userId;
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

  // Delegation linkages - these are handled specially by evaluateDelegatingLinkage
  // They return false here because the actual check is done via policy delegation
  cardcheckWorkerAccess: async () => false,
  esigEntityAccess: async () => false,
  fileEntityAccess: async () => false,

  // DNC linkages - check if user owns the worker or is associated with the employer on the DNC
  dncWorkerOwner: async (ctx, storage) => {
    if (ctx.entityType !== 'worker.dispatch.dnc') return false;
    
    // Get the DNC record using injected storage
    const dnc = await storage.workerDispatchDnc?.get?.(ctx.entityId);
    if (!dnc) return false;
    
    // Find user's contact by email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Find the worker that the user owns
    const userWorker = await storage.workers.getWorkerByContactId?.(contact.id);
    if (!userWorker) return false;
    
    // Check if the DNC's workerId matches the user's worker
    return dnc.workerId === userWorker.id;
  },

  dncEmployerAssoc: async (ctx, storage) => {
    if (ctx.entityType !== 'worker.dispatch.dnc') return false;
    
    // Get the DNC record using injected storage
    const dnc = await storage.workerDispatchDnc?.get?.(ctx.entityId);
    if (!dnc) return false;
    
    // Find user's contact by email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Check if user is an employer contact for the DNC's employer
    const employerContacts = await storage.employerContacts.listByEmployer(dnc.employerId);
    return employerContacts.some((ec: any) => ec.contactId === contact.id);
  },
};

// Register the DNC entity loader for attribute evaluation
// Uses storage.workerDispatchDnc which is injected at evaluation time
registerEntityLoader('worker.dispatch.dnc', async (entityId: string, storage: any) => {
  const dnc = await storage.workerDispatchDnc?.get?.(entityId);
  return dnc || null;
});

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
  cardcheckWorkerAccess: 'cardcheck',
  esigEntityAccess: 'esig',
  fileEntityAccess: 'file',
  dncWorkerOwner: 'worker.dispatch.dnc',
  dncEmployerAssoc: 'worker.dispatch.dnc',
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
 * Delegation linkages - these resolve the entity to a different policy
 * Returns null if not a delegation linkage, otherwise returns the result
 */
async function evaluateDelegatingLinkage(
  linkage: LinkagePredicate,
  ctx: EvaluationContext
): Promise<{ passed: boolean; reason?: string } | null> {
  // Only handle delegation linkages
  if (linkage === 'cardcheckWorkerAccess') {
    // Cardcheck -> Worker delegation
    if (ctx.entityType !== 'cardcheck') {
      return { passed: false, reason: 'cardcheckWorkerAccess requires cardcheck entity' };
    }
    
    const cardcheck = await ctx.storage.cardchecks?.getCardcheckById?.(ctx.entityId);
    if (!cardcheck) {
      return { passed: false, reason: 'Cardcheck not found' };
    }
    
    if (!cardcheck.workerId) {
      return { passed: false, reason: 'Cardcheck has no associated worker' };
    }
    
    // Determine which worker policy to check based on original policy
    // If evaluating cardcheck.edit, check worker.edit; if cardcheck.view, check worker.view
    const workerPolicyId = ctx.policyId === 'cardcheck.edit' ? 'worker.edit' : 'worker.view';
    
    // Recursively evaluate worker policy
    const workerResult = await evaluatePolicyInternal(
      ctx.user,
      workerPolicyId,
      ctx.storage,
      ctx.accessStorage,
      ctx.checkComponent,
      cardcheck.workerId,
      'worker'
    );
    
    return { passed: workerResult.granted, reason: workerResult.reason };
  }
  
  if (linkage === 'esigEntityAccess') {
    // Esig -> Entity delegation based on doc_type
    if (ctx.entityType !== 'esig') {
      return { passed: false, reason: 'esigEntityAccess requires esig entity' };
    }
    
    const esig = await ctx.storage.esigs?.getEsigById?.(ctx.entityId);
    if (!esig) {
      return { passed: false, reason: 'Esig not found' };
    }
    
    // Delegate based on doc_type
    if (esig.docType === 'cardcheck') {
      // Look up the cardcheck that references this esig (reverse lookup)
      const cardcheck = await ctx.storage.cardchecks?.getCardcheckByEsigId?.(ctx.entityId);
      if (!cardcheck) {
        return { passed: false, reason: 'Cardcheck not found for this esig' };
      }
      
      // Determine policy based on context - view operations get view access
      const isViewOnly = ctx.policyId?.includes('.view') || ctx.policyId?.includes('.read');
      const cardcheckPolicyId = isViewOnly ? 'cardcheck.view' : 'cardcheck.edit';
      
      const cardcheckResult = await evaluatePolicyInternal(
        ctx.user,
        cardcheckPolicyId,
        ctx.storage,
        ctx.accessStorage,
        ctx.checkComponent,
        cardcheck.id,
        'cardcheck'
      );
      
      return { passed: cardcheckResult.granted, reason: cardcheckResult.reason };
    }
    
    // Unknown doc_type - deny by default
    return { passed: false, reason: `Unknown esig doc_type: ${esig.docType}` };
  }
  
  if (linkage === 'fileEntityAccess') {
    // File -> Entity delegation based on entity_type
    if (ctx.entityType !== 'file') {
      return { passed: false, reason: 'fileEntityAccess requires file entity' };
    }
    
    const file = await ctx.storage.files?.getById?.(ctx.entityId);
    if (!file) {
      return { passed: false, reason: 'File not found' };
    }
    
    // Delegate based on entity_type
    if (file.entityType === 'esig' && file.entityId) {
      // Delegate to esig policy
      // Explicit list of read-only file operations that should delegate to esig.view
      const readOnlyPolicies = ['file.view', 'file.list', 'file.read', 'file.download', 'file.preview'];
      const isViewOnly = readOnlyPolicies.some(p => ctx.policyId?.endsWith(p) || ctx.policyId === p);
      const esigPolicyId = isViewOnly ? 'esig.view' : 'esig.edit';
      
      const esigResult = await evaluatePolicyInternal(
        ctx.user,
        esigPolicyId,
        ctx.storage,
        ctx.accessStorage,
        ctx.checkComponent,
        file.entityId,
        'esig'
      );
      
      return { passed: esigResult.granted, reason: esigResult.reason };
    }
    
    // Other entity types - deny by default (can be extended later)
    return { passed: false, reason: `Unknown file entity_type: ${file.entityType}` };
  }
  
  // Not a delegation linkage
  return null;
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
  policyId: string;
  entityType?: PolicyEntityType | string;
  entityId?: string;
  storage: any;
  accessStorage: AccessControlStorage;
  checkComponent: ComponentChecker;
  /** Track policies being evaluated to detect cycles */
  evaluatingPolicies?: Set<string>;
  /** Cached entity record for attribute evaluation (loaded once per evaluation) */
  entityRecordCache?: Map<string, Record<string, any> | null>;
}

/**
 * Get or load the entity record for attribute evaluation
 */
async function getEntityRecord(
  ctx: EvaluationContext
): Promise<Record<string, any> | null> {
  if (!ctx.entityType || !ctx.entityId) {
    return null;
  }

  // Check cache first
  const cacheKey = `${ctx.entityType}:${ctx.entityId}`;
  if (ctx.entityRecordCache?.has(cacheKey)) {
    return ctx.entityRecordCache.get(cacheKey) || null;
  }

  // Load via entity loader
  const loader = entityLoaders.get(ctx.entityType);
  if (!loader) {
    logger.debug(`No entity loader registered for type: ${ctx.entityType}`, { service: SERVICE });
    return null;
  }

  const record = await loader(ctx.entityId, ctx.storage);
  
  // Cache the result
  if (!ctx.entityRecordCache) {
    ctx.entityRecordCache = new Map();
  }
  ctx.entityRecordCache.set(cacheKey, record);

  return record;
}

/**
 * Evaluate attribute predicates against the entity record
 */
async function evaluateAttributes(
  predicates: AttributePredicate[],
  ctx: EvaluationContext
): Promise<{ passed: boolean; reason?: string }> {
  const record = await getEntityRecord(ctx);
  
  if (!record) {
    return { 
      passed: false, 
      reason: `Cannot evaluate attributes: entity record not found for ${ctx.entityType}:${ctx.entityId}` 
    };
  }

  for (const predicate of predicates) {
    const actualValue = record[predicate.path];
    let matches: boolean;

    switch (predicate.op) {
      case 'eq':
        matches = actualValue === predicate.value;
        break;
      case 'neq':
        matches = actualValue !== predicate.value;
        break;
      default:
        return { passed: false, reason: `Unknown attribute operator: ${predicate.op}` };
    }

    if (!matches) {
      return { 
        passed: false, 
        reason: `Attribute check failed: ${predicate.path} ${predicate.op} ${predicate.value} (actual: ${actualValue})` 
      };
    }
  }

  return { passed: true };
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

    // Handle delegation linkages specially
    const delegationResult = await evaluateDelegatingLinkage(condition.linkage, ctx);
    if (delegationResult !== null) {
      if (!delegationResult.passed) {
        return { passed: false, reason: delegationResult.reason || 'Delegation check failed' };
      }
      // Delegation passed, continue to other condition checks
    } else {
      // Standard linkage resolver
      const resolver = linkageResolvers[condition.linkage];
      if (!resolver) {
        logger.warn(`Unknown linkage predicate: ${condition.linkage}`, { service: SERVICE });
        return { passed: false, reason: `Unknown linkage predicate: ${condition.linkage}` };
      }

      const linkageCtx: LinkageContext = {
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        entityType: ctx.entityType as PolicyEntityType,
        entityId: ctx.entityId,
      };

      const hasLinkage = await resolver(linkageCtx, ctx.storage);
      if (!hasLinkage) {
        return { passed: false, reason: 'Linkage check failed' };
      }
    }
  }

  // Check referenced policy (with cycle detection)
  if (condition.policy) {
    // Clone the evaluation stack for this branch to avoid sibling branches corrupting state
    const evaluatingPolicies = new Set(ctx.evaluatingPolicies || []);
    
    // Build cycle key using the referenced policy and current entityId context
    const referencedCycleKey = ctx.entityId 
      ? `${condition.policy}:${ctx.entityId}` 
      : condition.policy;
    
    // Check for cycles BEFORE adding to set
    if (evaluatingPolicies.has(referencedCycleKey)) {
      logger.warn(`Cycle detected in policy evaluation: ${condition.policy}`, { 
        service: SERVICE, 
        policyId: ctx.policyId,
        referencedPolicy: condition.policy 
      });
      return { passed: false, reason: `Cycle detected: ${condition.policy}` };
    }
    
    // Get the referenced policy
    const referencedPolicy = accessPolicyRegistry.get(condition.policy);
    if (!referencedPolicy) {
      return { passed: false, reason: `Referenced policy not found: ${condition.policy}` };
    }
    
    // Add the referenced policy to the cloned set (push onto stack)
    evaluatingPolicies.add(referencedCycleKey);
    
    // Build new context for the referenced policy evaluation
    // IMPORTANT: Preserve entityId so entity-level policies work correctly
    const nestedCtx: EvaluationContext = {
      ...ctx,
      policyId: condition.policy,
      entityType: referencedPolicy.entityType || ctx.entityType,
      entityId: ctx.entityId, // Explicitly preserve entityId for entity-scoped policies
      evaluatingPolicies, // Pass the cloned set to avoid corrupting sibling branches
    };
    
    // Evaluate each rule of the referenced policy (OR - any rule grants access)
    let policyPassed = false;
    for (const rule of referencedPolicy.rules) {
      const result = await evaluateRule(rule, nestedCtx);
      if (result.passed) {
        policyPassed = true;
        break;
      }
    }
    
    // No need to pop from set - we used a cloned set so it's discarded after this scope
    
    if (!policyPassed) {
      return { passed: false, reason: `Referenced policy '${condition.policy}' denied access` };
    }
  }

  // Check attribute predicates (requires entity context and loader)
  if (condition.attributes && condition.attributes.length > 0) {
    if (!ctx.entityType || !ctx.entityId) {
      return { passed: false, reason: 'Attribute check requires entity context' };
    }
    
    const attributeResult = await evaluateAttributes(condition.attributes, ctx);
    if (!attributeResult.passed) {
      return attributeResult;
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
 * Internal policy evaluation that supports explicit entityType override
 * Used for delegation where we need to evaluate a policy for a different entity type
 */
async function evaluatePolicyInternal(
  user: User,
  policyId: string,
  storage: any,
  accessStorage: AccessControlStorage,
  checkComponent: ComponentChecker,
  entityId: string,
  entityTypeOverride: PolicyEntityType
): Promise<AccessResult> {
  const policy = accessPolicyRegistry.get(policyId);
  if (!policy) {
    return {
      granted: false,
      reason: `Unknown policy: ${policyId}`,
      evaluatedAt: Date.now(),
    };
  }

  // Check if user is admin (bypass all checks)
  const isAdmin = await accessStorage.hasPermission(user.id, 'admin');
  if (isAdmin) {
    return {
      granted: true,
      reason: 'Admin bypass',
      evaluatedAt: Date.now(),
    };
  }

  // Build evaluation context with explicit entityType
  const ctx: EvaluationContext = {
    user,
    policyId,
    entityType: entityTypeOverride,
    entityId,
    storage,
    accessStorage,
    checkComponent,
  };

  // Evaluate rules (OR - any rule grants access)
  for (const rule of policy.rules) {
    const result = await evaluateRule(rule, ctx);
    if (result.passed) {
      return {
        granted: true,
        reason: 'Access granted',
        evaluatedAt: Date.now(),
      };
    }
  }

  return {
    granted: false,
    reason: 'No matching access rule',
    evaluatedAt: Date.now(),
  };
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
    policyId,
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

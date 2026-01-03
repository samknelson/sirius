/**
 * Access Policy Types
 * 
 * Core types for the access policy system. Policies are defined as modular files
 * in shared/access-policies/ with custom evaluate functions.
 * 
 * LEGACY NOTE: The declarative registry (accessPolicyRegistry) and related types
 * (AccessPolicy, AccessRule, etc.) are retained for backwards compatibility with
 * the policy listing API. New policies should use the modular system exclusively.
 */

/**
 * Entity types that can have entity-level access policies
 */
export type PolicyEntityType = 'worker' | 'employer' | 'provider' | 'policy' | 'file' | 'contact' | 'cardcheck' | 'esig' | 'worker.dispatch.dnc';

/**
 * Attribute predicate operator
 */
export type AttributeOperator = 'eq' | 'neq';

/**
 * Attribute predicate - checks a field value on the entity record
 */
export interface AttributePredicate {
  /** Path to the field on the entity record (e.g., "type", "status") */
  path: string;
  /** Comparison operator */
  op: AttributeOperator;
  /** Expected value */
  value: string | number | boolean;
}

/**
 * Access condition - a single requirement that can grant or deny access
 */
export interface AccessCondition {
  /** Require user to be authenticated */
  authenticated?: boolean;
  
  /** Required permission key */
  permission?: string;
  
  /** Any of these permissions (OR) */
  anyPermission?: string[];
  
  /** All of these permissions (AND) */
  allPermissions?: string[];
  
  /** Required component to be enabled */
  component?: string;
  
  /** 
   * Legacy linkage predicate (deprecated - use modular policies with custom evaluate functions)
   * Retained for backwards compatibility with existing declarative policy definitions.
   */
  linkage?: string;
  
  /** 
   * Reference another policy that must also pass.
   * For entity-level policies, the same entityId is used.
   * This enables composite policies like "requires employer.dispatch permission AND employer.mine policy".
   */
  policy?: string;
  
  /**
   * Attribute predicates - check field values on the entity record.
   * All predicates must pass (AND). Requires entity loader to be registered for the entity type.
   */
  attributes?: AttributePredicate[];
}

/**
 * Access rule - can be a single condition, OR of conditions, or AND of conditions
 */
export type AccessRule = 
  | AccessCondition
  | { any: AccessCondition[] }  // OR - any condition grants access
  | { all: AccessCondition[] }; // AND - all conditions required

/**
 * Unified access policy definition
 */
export interface AccessPolicy {
  /** Unique policy identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what this policy grants */
  description: string;
  
  /**
   * Policy scope:
   * - 'route': For route-level middleware (no entity context)
   * - 'entity': For entity-level checks (requires entity ID)
   */
  scope: 'route' | 'entity';
  
  /**
   * Entity type this policy applies to (only for scope='entity')
   */
  entityType?: PolicyEntityType;
  
  /**
   * Access rules - evaluated as OR (any rule grants access)
   * Each rule can be a single condition or a composition of conditions
   */
  rules: AccessRule[];
}

/**
 * Result of a policy evaluation
 */
export interface AccessResult {
  granted: boolean;
  reason?: string;
  evaluatedAt: number;
}

/**
 * Cache key format for entity-level checks: userId:policyId:entityId
 */
export function buildCacheKey(userId: string, policyId: string, entityId?: string): string {
  if (entityId) {
    return `${userId}:${policyId}:${entityId}`;
  }
  return `${userId}:${policyId}`;
}

/**
 * Parse a cache key back into components
 */
export function parseCacheKey(key: string): { userId: string; policyId: string; entityId?: string } | null {
  const parts = key.split(':');
  if (parts.length === 2) {
    return { userId: parts[0], policyId: parts[1] };
  }
  if (parts.length === 3) {
    return { userId: parts[0], policyId: parts[1], entityId: parts[2] };
  }
  return null;
}

/**
 * Policy Registry - single source of truth for all access policies
 */
class AccessPolicyRegistry {
  private policies = new Map<string, AccessPolicy>();

  register(policy: AccessPolicy): void {
    if (this.policies.has(policy.id)) {
      throw new Error(`Access policy '${policy.id}' is already registered`);
    }
    this.policies.set(policy.id, policy);
  }

  get(id: string): AccessPolicy | undefined {
    return this.policies.get(id);
  }

  getAll(): AccessPolicy[] {
    return Array.from(this.policies.values());
  }

  getByScope(scope: 'route' | 'entity'): AccessPolicy[] {
    return Array.from(this.policies.values()).filter(p => p.scope === scope);
  }

  getByEntityType(entityType: PolicyEntityType): AccessPolicy[] {
    return Array.from(this.policies.values()).filter(
      p => p.scope === 'entity' && p.entityType === entityType
    );
  }

  has(id: string): boolean {
    return this.policies.has(id);
  }

  clear(): void {
    this.policies.clear();
  }
}

export const accessPolicyRegistry = new AccessPolicyRegistry();

/**
 * Define and register a route-level policy
 */
export function defineRoutePolicy(
  id: string,
  name: string,
  description: string,
  rules: AccessRule[]
): AccessPolicy {
  const policy: AccessPolicy = {
    id,
    name,
    description,
    scope: 'route',
    rules,
  };
  accessPolicyRegistry.register(policy);
  return policy;
}

/**
 * Define and register an entity-level policy
 */
export function defineEntityPolicy(
  id: string,
  name: string,
  description: string,
  entityType: PolicyEntityType,
  rules: AccessRule[]
): AccessPolicy {
  const policy: AccessPolicy = {
    id,
    name,
    description,
    scope: 'entity',
    entityType,
    rules,
  };
  accessPolicyRegistry.register(policy);
  return policy;
}

/**
 * Helper to create a simple permission-only policy
 * Most common pattern: just requires a single permission
 */
export function permissionPolicy(
  id: string,
  permission: string,
  name?: string,
  description?: string
): AccessPolicy {
  return defineRoutePolicy(
    id,
    name || `Requires ${permission}`,
    description || `Requires the ${permission} permission`,
    [{ permission }]
  );
}

// NOTE: conditionRequiresLinkage, ruleRequiresLinkage, and policyRequiresEntityContext
// functions were removed as they were only used by the legacy declarative evaluator.
// All policy evaluation now uses modular policies in shared/access-policies/.

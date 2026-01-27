/**
 * Modular Access Policy Framework
 * 
 * Each policy lives in its own file and can either:
 * - Declare simple rules (permissions, components, etc.)
 * - Implement custom evaluation logic via an evaluate() function
 * 
 * All policies share a common caching and evaluation infrastructure.
 */

import type { PolicyEntityType, AccessRule, AccessCondition, AttributePredicate } from '../accessPolicies';

/**
 * User context passed to policy evaluation
 */
export interface PolicyUser {
  id: string;
  email: string;
}

/**
 * Context provided to policy handlers during evaluation
 */
export interface PolicyContext {
  /** The authenticated user */
  user: PolicyUser;
  
  /** Entity ID being accessed (if entity-level policy) */
  entityId?: string;
  
  /** Entity data provided directly (for create operations) */
  entityData?: Record<string, any>;
  
  /** Check if user has a specific permission */
  hasPermission(permission: string): Promise<boolean>;
  
  /** Check if user has any of the specified permissions */
  hasAnyPermission(permissions: string[]): Promise<boolean>;
  
  /** Check if user has all of the specified permissions */
  hasAllPermissions(permissions: string[]): Promise<boolean>;
  
  /** Load an entity by type and ID */
  loadEntity<T = Record<string, any>>(entityType: string, entityId: string): Promise<T | null>;
  
  /** Evaluate another policy (for delegation) */
  checkPolicy(policyId: string, entityId?: string, entityData?: Record<string, any>): Promise<boolean>;
  
  /** Check if a component is enabled */
  isComponentEnabled(componentId: string): Promise<boolean>;
  
  /** Get the user's contact record (if exists) */
  getUserContact(): Promise<{ id: string; email: string } | null>;
  
  /** Get the worker record owned by this user (if exists) */
  getUserWorker(): Promise<{ id: string; contactId: string } | null>;
  
  /** Storage access for complex queries */
  storage: any;
}

/**
 * Result of policy evaluation
 */
export interface PolicyResult {
  granted: boolean;
  reason?: string;
}

/**
 * Policy definition - either declarative rules or custom evaluate function
 */
export interface PolicyDefinition {
  /** Unique policy identifier (e.g., 'worker.view', 'esig.edit') */
  id: string;
  
  /** Human-readable description */
  description?: string;
  
  /** Policy scope */
  scope: 'route' | 'entity';
  
  /** Entity type for entity-level policies */
  entityType?: PolicyEntityType;
  
  /** Required component for this policy to be active */
  component?: string;
  
  /**
   * Declarative rules (simple policies)
   * Evaluated as OR - any rule grants access
   */
  rules?: AccessRule[];
  
  /**
   * Custom evaluation function (complex policies)
   * Takes precedence over rules if both are defined
   */
  evaluate?: (ctx: PolicyContext) => Promise<PolicyResult>;
  
  /**
   * Describe the requirements for policies with custom evaluate functions.
   * Returns AccessRule[] in the same format as declarative rules, allowing
   * the UI to display consistent requirement descriptions.
   * Only needed for policies with evaluate() that want to show requirements.
   */
  describeRequirements?: () => AccessRule[];
  
  /**
   * Skip the admin bypass for this policy.
   * When true, the policy's evaluate function runs even for admins.
   * Use for policies with universal checks that apply to all users.
   */
  noAdminBypass?: boolean;
  
  /**
   * Skip caching for this policy.
   * Use for policies where the result depends on dynamic request data
   * (like entityData) that isn't part of the cache key.
   */
  skipCache?: boolean;
  
  /**
   * Entity fields to include in the cache key.
   * The entity will be loaded first and these field values will be appended to the cache key.
   * Use for policies where the result depends on entity state (like status).
   */
  cacheKeyFields?: string[];
}

/**
 * Helper to define a policy with type safety
 */
export function definePolicy(definition: PolicyDefinition): PolicyDefinition {
  return definition;
}

/**
 * Helper to create a simple permission-based route policy
 */
export function permissionPolicy(
  id: string, 
  permission: string, 
  description?: string
): PolicyDefinition {
  return {
    id,
    description: description || `Requires ${permission} permission`,
    scope: 'route',
    rules: [{ permission }],
  };
}

/**
 * Helper to create a route policy with multiple permission options (OR)
 */
export function anyPermissionPolicy(
  id: string,
  permissions: string[],
  description?: string
): PolicyDefinition {
  return {
    id,
    description: description || `Requires any of: ${permissions.join(', ')}`,
    scope: 'route',
    rules: [{ anyPermission: permissions }],
  };
}

/**
 * Helper to create an entity policy with declarative rules
 */
export function entityPolicy(
  id: string,
  entityType: PolicyEntityType,
  rules: AccessRule[],
  description?: string
): PolicyDefinition {
  return {
    id,
    description,
    scope: 'entity',
    entityType,
    rules,
  };
}

/**
 * Policy module registry - populated by importing policy files
 */
const policyModules = new Map<string, PolicyDefinition>();

/**
 * Register a policy module
 */
export function registerPolicy(policy: PolicyDefinition): void {
  if (policyModules.has(policy.id)) {
    console.warn(`Policy '${policy.id}' is being re-registered`);
  }
  policyModules.set(policy.id, policy);
}

/**
 * Get a registered policy
 */
export function getPolicy(id: string): PolicyDefinition | undefined {
  return policyModules.get(id);
}

/**
 * Get all registered policies
 */
export function getAllPolicies(): PolicyDefinition[] {
  return Array.from(policyModules.values());
}

/**
 * Check if a policy is registered
 */
export function hasPolicy(id: string): boolean {
  return policyModules.has(id);
}

/**
 * Clear all registered policies (for testing)
 */
export function clearPolicies(): void {
  policyModules.clear();
}

/**
 * Get policies by scope
 */
export function getPoliciesByScope(scope: 'route' | 'entity'): PolicyDefinition[] {
  return getAllPolicies().filter(p => p.scope === scope);
}

/**
 * Get policies by entity type
 */
export function getPoliciesByEntityType(entityType: PolicyEntityType): PolicyDefinition[] {
  return getAllPolicies().filter(p => p.entityType === entityType);
}

/**
 * Get policies that require a specific component
 */
export function getPoliciesByComponent(componentId: string): PolicyDefinition[] {
  return getAllPolicies().filter(p => p.component === componentId);
}

// Re-export types from accessPolicies for convenience
export type { 
  PolicyEntityType, 
  AccessRule, 
  AccessCondition, 
  AttributePredicate 
} from '../accessPolicies';

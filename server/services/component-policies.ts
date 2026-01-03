import { componentRegistry, ComponentDefinition, ComponentPolicy, ComponentPolicyRuleAttribute } from "../../shared/components";
import { accessPolicyRegistry, AccessPolicy, AccessCondition, AccessRule, LinkagePredicate, AttributePredicate } from "../../shared/accessPolicies";
import { isComponentEnabledSync } from "./component-cache";
import { logger } from "../logger";

const VALID_LINKAGES: Set<string> = new Set([
  'ownsWorker', 'workerBenefitProvider', 'workerEmploymentHistory', 
  'employerAssociation', 'providerAssociation', 'fileUploader',
  'contactWorkerOwner', 'contactWorkerProvider', 'contactEmployerAssoc',
  'contactProviderAssoc', 'cardcheckWorkerAccess', 'esigEntityAccess', 'fileEntityAccess',
  'dncWorkerOwner', 'dncEmployerAssoc'
]);

const VALID_ENTITY_TYPES: Set<string> = new Set([
  'worker', 'employer', 'provider', 'policy', 'file', 'contact', 'cardcheck', 'esig',
  'worker.dispatch.dnc'
]);

const VALID_ATTRIBUTE_OPS: Set<string> = new Set(['eq', 'neq']);

/**
 * Validate a component policy definition
 * Returns an error message if invalid, or null if valid
 * 
 * Note: Referenced policies are validated against existing registry entries.
 * If a policy references another policy from the same component batch, 
 * that reference may not exist yet - we log a warning but allow registration.
 */
function validatePolicy(policy: ComponentPolicy, componentId: string): string | null {
  if (!policy.id) {
    return `Policy in component '${componentId}' is missing an id`;
  }
  
  if (policy.scope === 'entity' && !policy.entityType) {
    return `Entity-scoped policy '${policy.id}' in component '${componentId}' is missing entityType`;
  }
  
  if (policy.entityType && !VALID_ENTITY_TYPES.has(policy.entityType)) {
    return `Policy '${policy.id}' in component '${componentId}' has invalid entityType: ${policy.entityType}`;
  }
  
  for (const rule of policy.rules) {
    if (rule.linkage && !VALID_LINKAGES.has(rule.linkage)) {
      return `Policy '${policy.id}' in component '${componentId}' has invalid linkage: ${rule.linkage}`;
    }
    
    // Check that referenced policies exist in the registry
    // Note: Core policies should already be registered, component policies may be in same batch
    if (rule.policy) {
      if (!accessPolicyRegistry.has(rule.policy)) {
        // Log warning for missing policy references
        // This isn't necessarily an error - the referenced policy might be:
        // 1. From the same component being registered in this batch
        // 2. From another component that hasn't been enabled yet
        logger.warn(`Policy '${policy.id}' references unknown policy '${rule.policy}'`, {
          service: "component-policies",
          componentId,
          policyId: policy.id,
          referencedPolicy: rule.policy
        });
      }
    }
    
    // Validate attribute predicates
    if (rule.attributes && rule.attributes.length > 0) {
      // Attributes require entity scope (or at least an entityType)
      if (policy.scope !== 'entity' && !policy.entityType) {
        return `Policy '${policy.id}' has attributes but is not entity-scoped`;
      }
      
      for (const attr of rule.attributes) {
        if (!attr.path) {
          return `Policy '${policy.id}' has attribute predicate with missing path`;
        }
        if (!VALID_ATTRIBUTE_OPS.has(attr.op)) {
          return `Policy '${policy.id}' has invalid attribute operator: ${attr.op}`;
        }
        if (attr.value === undefined || attr.value === null) {
          return `Policy '${policy.id}' has attribute predicate with missing value for path '${attr.path}'`;
        }
      }
    }
  }
  
  return null;
}

/**
 * Convert a ComponentPolicyRule to an AccessCondition
 */
function convertRule(rule: ComponentPolicy['rules'][0]): AccessCondition {
  return {
    authenticated: rule.authenticated,
    permission: rule.permission,
    anyPermission: rule.anyPermission,
    allPermissions: rule.allPermissions,
    component: rule.component,
    linkage: rule.linkage as LinkagePredicate,
    policy: rule.policy,
    attributes: rule.attributes as AttributePredicate[] | undefined,
  };
}

/**
 * Sync component-defined policies to the access policy registry.
 * Called during startup after components are loaded.
 * Only registers policies for enabled components.
 */
export function syncComponentPolicies(): void {
  const enabledComponents = componentRegistry.filter(component => 
    isComponentEnabledSync(component.id) && component.policies && component.policies.length > 0
  );

  let registeredCount = 0;

  for (const component of enabledComponents) {
    for (const componentPolicy of component.policies!) {
      // Validate policy definition
      const validationError = validatePolicy(componentPolicy, component.id);
      if (validationError) {
        logger.error(`Invalid component policy: ${validationError}`, {
          service: "component-policies",
          componentId: component.id,
          policyId: componentPolicy.id
        });
        continue; // Skip invalid policies
      }
      
      if (!accessPolicyRegistry.has(componentPolicy.id)) {
        const accessPolicy: AccessPolicy = {
          id: componentPolicy.id,
          name: componentPolicy.id,
          description: componentPolicy.description,
          scope: componentPolicy.scope,
          entityType: componentPolicy.entityType as any,
          rules: componentPolicy.rules.map(rule => convertRule(rule)) as AccessRule[],
        };
        
        accessPolicyRegistry.register(accessPolicy);
        registeredCount++;
        
        logger.debug(`Registered policy from component`, { 
          service: "component-policies",
          policyId: componentPolicy.id, 
          componentId: component.id 
        });
      }
    }
  }

  if (registeredCount > 0) {
    logger.info(`Component policies registered`, { 
      service: "component-policies",
      count: registeredCount 
    });
  }
}

/**
 * Get all components that define policies
 */
export function getComponentsWithPolicies(): ComponentDefinition[] {
  return componentRegistry.filter(c => c.policies && c.policies.length > 0);
}

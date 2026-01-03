export interface TrustBenefit {
  id: string;
  name: string;
  benefitTypeName?: string;
  benefitTypeIcon?: string;
  isActive?: boolean;
}

/**
 * Attribute predicate - checks a field value on the entity record
 */
export interface AttributePredicate {
  path: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
}

/**
 * Access condition from the server - matches the AccessCondition interface
 */
export interface AccessCondition {
  authenticated?: boolean;
  permission?: string;
  anyPermission?: string[];
  allPermissions?: string[];
  component?: string;
  linkage?: string;
  policy?: string;
  attributes?: AttributePredicate[];
}

/**
 * Access rule - can be a single condition or composition
 */
export type AccessRequirement =
  | AccessCondition
  | { any: AccessCondition[] }
  | { all: AccessCondition[] };

export interface Policy {
  id: string;
  name: string;
  description: string;
  requirements: AccessRequirement[];
}

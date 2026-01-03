export interface TrustBenefit {
  id: string;
  name: string;
  benefitTypeName?: string;
  benefitTypeIcon?: string;
  isActive?: boolean;
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

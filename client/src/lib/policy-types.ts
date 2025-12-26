export interface TrustBenefit {
  id: string;
  name: string;
  benefitTypeName?: string;
  benefitTypeIcon?: string;
  isActive?: boolean;
}

export type AccessRequirement =
  | { type: 'authenticated' }
  | { type: 'permission'; key: string }
  | { type: 'anyPermission'; keys: string[] }
  | { type: 'allPermissions'; keys: string[] }
  | { type: 'component'; componentId: string }
  | { type: 'ownership'; resourceType: string; resourceIdParam?: string }
  | { type: 'anyOf'; options: AccessRequirement[] }
  | { type: 'allOf'; options: AccessRequirement[] }
  | { type: 'custom'; reason?: string };

export interface Policy {
  id: string;
  name: string;
  description: string;
  requirements: AccessRequirement[];
}

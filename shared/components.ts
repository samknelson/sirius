export interface ComponentDefinition {
  id: string;
  name: string;
  description: string;
  enabledByDefault: boolean;
  category?: string;
}

export interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

// Central registry of all available components
export const componentRegistry: ComponentDefinition[] = [
  {
    id: "ledger",
    name: "Ledger",
    description: "Functionality for tracking charges and payments",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "ledger.stripe",
    name: "Stripe Integration",
    description: "Integration with the Stripe payment processing system",
    enabledByDefault: false,
    category: "ledger"
  },
  {
    id: "cardcheck",
    name: "Card Check",
    description: "Worker cardcheck functionality",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "sitespecific.gbhet",
    name: "GBHET Customization",
    description: "Custom functionality for GBHET",
    enabledByDefault: false,
    category: "site-specific"
  },
  {
    id: "sitespecific.gbhet.legal",
    name: "GBHET Legal Benefit",
    description: "Custom legal benefit functionality for GBHET",
    enabledByDefault: false,
    category: "sitespecific.gbhet"
  },
  {
    id: "sitespecific.btu",
    name: "BTU Customization",
    description: "Custom functionality for BTU",
    enabledByDefault: false,
    category: "site-specific"
  },
  {
    id: "employer.login",
    name: "Employer Login",
    description: "Ability for employers to log in",
    enabledByDefault: false,
    category: "authentication"
  },
  {
    id: "worker.login",
    name: "Worker Login",
    description: "Ability for workers to log in",
    enabledByDefault: false,
    category: "authentication"
  },
  {
    id: "trust.providers.login",
    name: "Trust Provider Login",
    description: "Ability for trust provider contacts to log in",
    enabledByDefault: false,
    category: "authentication"
  },
  {
    id: "trust.providers",
    name: "Trust Providers",
    description: "Management and tracking of trust providers",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "trust.benefits",
    name: "Trust Benefits",
    description: "Management of trust benefits and eligibility",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "trust.benefits.scan",
    name: "Trust Benefit Scan",
    description: "Automated scanning for worker benefit eligibility",
    enabledByDefault: false,
    category: "trust.benefits"
  }
];

/**
 * Get all registered components
 */
export function getAllComponents(): ComponentDefinition[] {
  return componentRegistry;
}

/**
 * Get a component by ID
 */
export function getComponentById(id: string): ComponentDefinition | undefined {
  return componentRegistry.find(component => component.id === id);
}

/**
 * Get components by category
 */
export function getComponentsByCategory(category: string): ComponentDefinition[] {
  return componentRegistry.filter(component => component.category === category);
}

/**
 * Get the parent component ID from a component ID
 * For example: "trust.providers.login" -> "trust.providers"
 *              "ledger.stripe" -> "ledger"
 *              "ledger" -> null
 */
export function getParentComponentId(componentId: string): string | null {
  const lastDotIndex = componentId.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return null;
  }
  return componentId.substring(0, lastDotIndex);
}

/**
 * Get all ancestor component IDs for a component
 * For example: "a.b.c" -> ["a.b", "a"]
 *              "ledger.stripe" -> ["ledger"]
 */
export function getAncestorComponentIds(componentId: string): string[] {
  const ancestors: string[] = [];
  let current = getParentComponentId(componentId);
  
  while (current !== null) {
    ancestors.push(current);
    current = getParentComponentId(current);
  }
  
  return ancestors;
}

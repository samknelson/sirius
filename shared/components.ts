export interface ComponentDefinition {
  id: string;
  name: string;
  description: string;
  enabledByDefault: boolean;
  category?: string;
  managesSchema?: boolean;
  schemaManifest?: ComponentSchemaManifest;
}

export interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

export interface ComponentSchemaManifest {
  version?: number;
  schemaPath: string;
  tables: string[];
}

export type ComponentTableStatus = "active" | "dropped" | "pending" | "error";

export interface ComponentTableState {
  tableName: string;
  status: ComponentTableStatus;
  appliedAt: string | null;
  droppedAt: string | null;
  checksum: string;
  errorMessage?: string;
}

export interface ComponentSchemaDrift {
  lastCheckAt: string;
  hasUnexpectedTables: boolean;
  hasMissingTables: boolean;
  details: string[];
}

export interface ComponentSchemaState {
  manifestVersion: number;
  lastSyncedAt: string;
  tables: ComponentTableState[];
  drift: ComponentSchemaDrift | null;
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
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/cardcheck/schema.ts",
      tables: ["cardcheck_definitions", "cardchecks"]
    }
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
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/sitespecific/btu/schema.ts",
      tables: ["sitespecific_btu_csg", "sitespecific_btu_employer_map"]
    }
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
    id: "worker.steward",
    name: "Shop Stewards",
    description: "Ability to designate workers as shop stewards",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/steward/schema.ts",
      tables: ["worker_steward_assignments"]
    }
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
  },
  {
    id: "event",
    name: "Events",
    description: "In-person and virtual events that contacts can register for",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "bargainingunits",
    name: "Bargaining Units",
    description: "Management of bargaining units and worker associations",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "dispatch",
    name: "Dispatch",
    description: "Dispatch functionality",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/schema.ts",
      tables: ["options_dispatch_job_type", "dispatch_jobs", "dispatches", "worker_dispatch_status", "worker_dispatch_elig_denorm"]
    }
  },
  {
    id: "dispatch.dnc",
    name: "Dispatch Do Not Call",
    description: "Do Not Call list management for dispatch",
    enabledByDefault: false,
    category: "dispatch",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/dnc-schema.ts",
      tables: ["worker_dispatch_dnc"]
    }
  },
  {
    id: "dispatch.hfe",
    name: "Dispatch Hold for Employer",
    description: "Hold for Employer management for dispatch",
    enabledByDefault: false,
    category: "dispatch",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/hfe-schema.ts",
      tables: ["worker_dispatch_hfe"]
    }
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

/**
 * Get the variable name for a component's enabled state
 * For example: "sitespecific.btu" -> "component_sitespecific.btu"
 */
export function getComponentVariableName(componentId: string): string {
  return `component_${componentId}`;
}

/**
 * Get the variable name for a component's schema state
 * For example: "sitespecific.btu" -> "component_schema_state_sitespecific.btu"
 */
export function getComponentSchemaStateVariableName(componentId: string): string {
  return `component_schema_state_${componentId}`;
}

/**
 * Get all components that manage schemas
 */
export function getSchemaManagingComponents(): ComponentDefinition[] {
  return componentRegistry.filter(c => c.managesSchema && c.schemaManifest);
}


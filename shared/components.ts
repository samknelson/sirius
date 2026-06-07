export interface ComponentPermission {
  key: string;
  description: string;
}

export interface ComponentPolicy {
  id: string;
  description: string;
  scope: 'route' | 'entity';
  entityType?: string;
  rules: ComponentPolicyRule[];
}

export interface ComponentPolicyRuleAttribute {
  path: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
}

export interface ComponentPolicyRule {
  permission?: string;
  anyPermission?: string[];
  allPermissions?: string[];
  component?: string;
  policy?: string;
  authenticated?: boolean;
  attributes?: ComponentPolicyRuleAttribute[];
}

/**
 * A `plugin_configs` row a component owns and materializes through its
 * enable/disable lifecycle (Task #397). On enable the row is created if
 * missing (keyed by its stable {@link siriusId}) else re-activated
 * (`enabled = true`) while preserving any admin edits to name/ordering/data.
 * On disable the row is set `enabled = false` and retained so edits survive a
 * disable/enable cycle. The `auto.<componentId>.<localId>` siriusId scheme
 * marks the row as component-owned.
 */
export interface ComponentManagedPluginConfig {
  /** PluginKind discriminator, e.g. "client-injection". */
  pluginType: string;
  /** Registered impl id, e.g. "weglot-sdk". */
  pluginId: string;
  /** Stable, unique, editable identifier. Use `auto.<componentId>.<localId>`. */
  siriusId: string;
  /** Initial display name (admin may rename; preserved on re-enable). */
  name?: string;
  /** Initial ordering (admin may change; preserved on re-enable). */
  ordering?: number;
  /** Initial editable settings payload (admin may edit; preserved on re-enable). */
  data?: Record<string, unknown>;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  description: string;
  enabledByDefault: boolean;
  category?: string;
  managesSchema?: boolean;
  schemaManifest?: ComponentSchemaManifest;
  permissions?: ComponentPermission[];
  policies?: ComponentPolicy[];
  /**
   * Plugin configs this component owns and materializes via its lifecycle.
   * See {@link ComponentManagedPluginConfig}.
   */
  pluginConfigs?: ComponentManagedPluginConfig[];
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
  /**
   * Highest per-component migration version that has been applied to this
   * deployment. Missing/absent is treated as 0. This counter PERSISTS across
   * component disable/enable cycles, so re-enabling a component whose tables
   * were retained will not re-run migrations it has already applied.
   *
   * Per-component migrations live under
   * `scripts/migrate/components/<component-id>/` and are registered via
   * `registerComponentMigration(componentId, migration)`.
   */
  migrationVersion?: number;
  /**
   * Optional audit trail of applied per-component migrations. Each entry is
   * appended after a successful `up()`. Older deployments will not have this
   * field; downstream consumers must treat it as optional.
   */
  migrationsApplied?: { version: number; name: string; appliedAt: string }[];
}

// Central registry of all available components
export const componentRegistry: ComponentDefinition[] = [
  {
    id: "ledger",
    name: "Ledger",
    description: "Functionality for tracking charges and payments",
    enabledByDefault: false,
    category: "core",
    permissions: [
      {
        key: "employer.ledger",
        description: "Access to employer ledger functionality for employer users"
      },
      {
        key: "worker.ledger",
        description: "Access to worker ledger functionality for worker users"
      }
    ]
  },
  {
    id: "ledger.stripe",
    name: "Stripe Integration",
    description: "Integration with the Stripe payment processing system",
    enabledByDefault: false,
    category: "ledger"
  },
  {
    id: "ledger.payment.batch",
    name: "Payment Batches",
    description: "Batch creation and management of payments",
    enabledByDefault: false,
    category: "ledger",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/ledger/payment-batch/schema.ts",
      tables: ["ledger_payment_batches", "ledger_payment_batch_assignments"]
    }
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
    id: "sitespecific.gbhet.pension",
    name: "GBHET VDB Pension",
    description: "Variable Defined Benefit pension module for GBHET (plan years, accrual tiers, AI/payout/early retirement factors, share values, employer plans, interest rates)",
    enabledByDefault: false,
    category: "sitespecific.gbhet",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/sitespecific/gbhet-pension/schema.ts",
      tables: [
        "gbhet_pension_benefit_schedules",
        "gbhet_pension_accrual_tiers",
        "gbhet_pension_annual_summary",
        "gbhet_pension_share_values",
        "gbhet_pension_plan_years",
        "gbhet_pension_employer_plans",
        "gbhet_pension_ai_factors",
        "gbhet_pension_payout_factors",
        "gbhet_pension_early_retirement_factors",
        "gbhet_pension_interest_rates"
      ]
    }
  },
  {
    id: "sitespecific.btu",
    name: "BTU Customization",
    description: "Custom functionality for BTU",
    enabledByDefault: false,
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 3,
      schemaPath: "./shared/schema/sitespecific/btu/schema.ts",
      tables: [
        "sitespecific_btu_csg",
        "sitespecific_btu_employer_map",
        "sitespecific_btu_school_types",
        "sitespecific_btu_regions",
        "sitespecific_btu_school_attributes",
        "btu_territories",
        "btu_territory_reps",
        "btu_territory_workers"
      ]
    }
  },
  {
    id: "sitespecific.btu.political",
    name: "BTU Political Profile",
    description: "Political representative lookup and tracking for workers using Google Civic Information API",
    enabledByDefault: false,
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 2,
      schemaPath: "./shared/schema/sitespecific/btu/political-schema.ts",
      tables: [
        "sitespecific_btu_political_officials",
        "sitespecific_btu_political_worker_reps",
        "sitespecific_btu_political_district_cache"
      ]
    }
  },
  {
    id: "sitespecific.hta",
    name: "HTA Customization",
    description: "Custom functionality for Hospitality Training Academy",
    enabledByDefault: false,
    category: "site-specific"
  },
  {
    id: "employer.login",
    name: "Employer Login",
    description: "Ability for employers to log in",
    enabledByDefault: false,
    category: "authentication",
    permissions: [
      {
        key: "employer",
        description: "Employer level access"
      },
      {
        key: "employer.manage",
        description: "Manage user accounts for employer contacts"
      }
    ]
  },
  {
    id: "employer.company",
    name: "Employer Companies",
    description: "Allows related employers to be grouped together in companies",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/employer/company-schema.ts",
      tables: ["companies", "employer_companies"]
    }
  },
  {
    id: "worker.login",
    name: "Worker Login",
    description: "Ability for workers to log in",
    enabledByDefault: false,
    category: "authentication",
    permissions: [
      {
        key: "worker",
        description: "Worker level access"
      }
    ]
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
    },
    permissions: [
      {
        key: "worker.steward",
        description: "Access to shop steward functionality for workers"
      }
    ]
  },
  {
    id: "worker.skills",
    name: "Worker Skills",
    description: "Management of worker skills and qualifications",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/skills/schema.ts",
      tables: ["options_skills", "worker_skills"]
    }
  },
  {
    id: "worker.certifications",
    name: "Worker Certifications",
    description: "Management of worker certifications and credentials",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/certifications/schema.ts",
      tables: ["options_certifications", "worker_certifications"]
    }
  },
  {
    id: "worker.ratings",
    name: "Worker Ratings",
    description: "Management of worker performance ratings",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/ratings/schema.ts",
      tables: ["options_worker_ratings", "worker_ratings"]
    }
  },
  {
    id: "worker.tos",
    name: "Time Off Sick",
    description: "Tracking of worker unplanned absences (Time Off Sick)",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/tos/schema.ts",
      tables: ["worker_tos"]
    }
  },
  {
    id: "worker.relations",
    name: "Worker Relations",
    description: "Management of relationships between workers",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/worker/relations/schema.ts",
      tables: ["options_worker_relation_type", "worker_relations"]
    }
  },
  {
    id: "trust.providers.login",
    name: "Trust Provider Login",
    description: "Ability for trust provider contacts to log in",
    enabledByDefault: false,
    category: "authentication",
    permissions: [
      {
        key: "trust.provider",
        description: "Provider level access"
      },
      {
        key: "trust.provider.manage",
        description: "Manage provider user accounts"
      },
      {
        key: "trust.provider.ledger",
        description: "Access to provider ledger functionality for provider users"
      }
    ]
  },
  {
    id: "trust.providers",
    name: "Trust Providers",
    description: "Management and tracking of trust providers",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "trust.providers.edi",
    name: "Provider Data Interchange",
    description: "Data interchange functionality for trust providers",
    enabledByDefault: false,
    category: "trust.providers",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/trust/provider-edi-schema.ts",
      tables: ["trust_provider_edi"]
    }
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
    id: "trust.benefits.eligibility.exemptions",
    name: "Eligibility Exemptions",
    description: "Exempt individual members from specified eligibility plugins",
    enabledByDefault: false,
    category: "trust.benefits.eligibility",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/trust/eligibility-exemptions-schema.ts",
      tables: ["trust_benefit_eligibility_exemptions"]
    }
  },
  {
    id: "trust.elections",
    name: "Trust Elections",
    description: "Worker elections (stub)",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/trust/elections-schema.ts",
      tables: ["worker_trust_elections"]
    }
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
    },
    permissions: [
      { key: "employer.dispatch", description: "Employer access to dispatch functionality" },
      { key: "employer.dispatch.manage", description: "Employer access to manage dispatch functionality" },
      { key: "dispatch.edit", description: "Edit dispatch jobs and job types" },
      { key: "dispatch.delete", description: "Delete dispatch job types" }
    ],
    policies: [
      {
        id: "employer.dispatch",
        description: "Access dispatch functionality for associated employers",
        scope: "entity",
        entityType: "employer",
        rules: [
          { permission: "staff" },
          { permission: "employer.dispatch", policy: "employer.mine" }
        ]
      },
      {
        id: "employer.dispatch.manage",
        description: "Manage dispatch functionality for associated employers",
        scope: "entity",
        entityType: "employer",
        rules: [
          { permission: "staff" },
          { permission: "employer.dispatch.manage", policy: "employer.mine" }
        ]
      }
    ]
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
    },
    permissions: [
      { key: "worker", description: "Worker access to their own data" }
    ],
    policies: [
      {
        id: "worker.dispatch.dnc.view",
        description: "View DNC records associated with the user's worker or employer",
        scope: "entity",
        entityType: "worker.dispatch.dnc",
        rules: [
          { permission: "staff" }
        ]
      },
      {
        id: "worker.dispatch.dnc.edit",
        description: "Edit DNC records - workers edit type='worker', employers edit type='employer'",
        scope: "entity",
        entityType: "worker.dispatch.dnc",
        rules: [
          { permission: "staff" }
        ]
      }
    ]
  },
  {
    id: "dispatch.hfe",
    name: "Dispatch Employer Priority",
    description: "Employer Priority management for dispatch",
    enabledByDefault: false,
    category: "dispatch",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/hfe-schema.ts",
      tables: ["worker_dispatch_hfe"]
    }
  },
  {
    id: "dispatch.ban",
    name: "Dispatch Ban",
    description: "Excludes workers with active dispatch bans from dispatch eligibility",
    enabledByDefault: false,
    category: "dispatch"
  },
  {
    id: "dispatch.eba",
    name: "Employed but Available",
    description: "Tracks workers who are employed but available for dispatch",
    enabledByDefault: false,
    category: "dispatch",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/eba-schema.ts",
      tables: ["worker_dispatch_eba"]
    }
  },
  {
    id: "dispatch.singleshift",
    name: "Single Shift Dispatch",
    description: "Manages single-shift dispatch assignments for workers",
    enabledByDefault: false,
    category: "dispatch",
  },
  {
    id: "dispatch.job_group",
    name: "Dispatch Job Groups",
    description: "Grouping of dispatch jobs",
    enabledByDefault: false,
    category: "dispatch",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/dispatch/job-group-schema.ts",
      tables: ["dispatch_job_group"]
    }
  },
  {
    id: "facility",
    name: "Facilities",
    description: "Facility records linked to contacts, optionally synced from external systems",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/facility/schema.ts",
      tables: ["facilities"]
    }
  },
  {
    id: "debug",
    name: "Debug",
    description: "Debug tools and developer utilities",
    enabledByDefault: false,
    category: "developer",
    permissions: [
      { key: "debug", description: "Access to debug tools and raw data viewers" }
    ]
  },
  {
    id: "edls",
    name: "Employer Day Labor Scheduler",
    description: "Day labor scheduling functionality for employers",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/edls/schema.ts",
      tables: ["edls_sheets", "edls_crews", "edls_assignments", "options_edls_tasks", "worker_edls"]
    },
    permissions: [
      { key: "edls.manager", description: "Full EDLS management access" },
      { key: "edls.coordinator", description: "EDLS coordination and scheduling access" },
      { key: "edls.supervisor", description: "EDLS supervisory access" },
      { key: "edls.reader", description: "Read-only access to EDLS data" },
      { key: "edls.worker.advisor", description: "Worker advisor access for EDLS" }
    ]
  },
  {
    id: "sitespecific.freeman",
    name: "Freeman Customization",
    description: "Custom functionality for Freeman",
    enabledByDefault: false,
    category: "site-specific"
  },
  {
    id: "sitespecific.t631.client",
    name: "Teamsters 631 Client",
    description: "Client connection to the Teamsters 631 site",
    enabledByDefault: false,
    category: "site-specific"
  },
  {
    id: "sitespecific.bao",
    name: "BAO Customization",
    description: "Custom functionality for Unite Here Local 11 Health Benefits Administration",
    enabledByDefault: false,
    category: "site-specific",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/sitespecific/bao/schema.ts",
      tables: ["sitespecific_bao_employer_immediate_eligibility"]
    }
  },
  {
    id: "bulk",
    name: "Bulk Messaging",
    description: "Bulk messaging functionality",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/bulk/schema.ts",
      tables: ["bulk_messages", "bulk_messages_email", "bulk_messages_sms", "bulk_messages_postal", "bulk_messages_inapp", "bulk_participants"]
    },
    permissions: [
      { key: "staff.bulk", description: "Access to bulk messaging functionality" }
    ]
  },
  {
    id: "internationalization",
    name: "Internationalization",
    description: "Umbrella feature flag for translation and localization providers.",
    enabledByDefault: false,
    category: "core"
  },
  {
    id: "internationalization.weglot",
    name: "Weglot Translation",
    description: "Injects the Weglot SDK and initializer so site content can be translated on the fly.",
    enabledByDefault: false,
    category: "internationalization",
    pluginConfigs: [
      {
        pluginType: "client-injection",
        pluginId: "weglot-sdk",
        siriusId: "auto.internationalization.weglot.sdk",
        name: "Weglot SDK",
        ordering: 10,
      },
      {
        pluginType: "client-injection",
        pluginId: "weglot-init",
        siriusId: "auto.internationalization.weglot.init",
        name: "Weglot Initialization",
        ordering: 20,
      },
    ],
  },
  {
    id: "system.sftp.client",
    name: "SFTP Client",
    description: "SFTP client for secure file transfers",
    enabledByDefault: false,
    category: "core",
    managesSchema: true,
    schemaManifest: {
      version: 1,
      schemaPath: "./shared/schema/system/sftp-client-schema.ts",
      tables: ["sftp_client_destinations"]
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

/**
 * Get all descendant component IDs for a component
 * For example: "dispatch" -> ["dispatch.dnc", "dispatch.hfe", "dispatch.status"]
 *              "trust" -> ["trust.providers", "trust.providers.login", ...]
 */
export function getDescendantComponentIds(componentId: string): string[] {
  const prefix = componentId + '.';
  return componentRegistry
    .filter(c => c.id.startsWith(prefix))
    .map(c => c.id);
}


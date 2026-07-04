import type { Request } from "express";
import type { JsonSchema } from "@shared/json-schema-form";
import type { Wizard } from "@shared/schema";
import type { storage as storageType } from "../../storage";
import type { BasePluginMetadata } from "../_core";

/**
 * The kinds of step a wizard plugin can declare. The fixed dispatcher
 * route set knows how to drive each one; adding a wizard never adds a
 * route.
 *
 * - `form`   → server JSON schema, rendered by the shared SchemaForm.
 *              Submitted via POST .../dispatch/:stepId/submit.
 * - `upload` → multipart file, POST .../dispatch/:stepId/upload.
 * - `run`    → async background work, POST .../dispatch/:stepId/run,
 *              progress polled off the wizard load route.
 * - `review` → confirmation step, POST .../dispatch/:stepId/submit.
 * - `results`→ read-only output view (columns + rows + CSV export),
 *              read via GET .../dispatch/:stepId/data and .../export.
 * - `custom` → escape hatch: an auto-discovered React component.
 */
export type WizardStepKind =
  | "form"
  | "upload"
  | "run"
  | "review"
  | "results"
  | "custom";

export type WizardStepState =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

/** Uploaded file handed to an `upload` step's handler. */
export interface WizardUploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Context handed to a step handler. Handlers do NOT persist wizard state
 * themselves — they return a `WizardStepResult` and the dispatcher owns
 * the read-modify-write. All data access goes through `storage`.
 */
export interface WizardStepContext {
  wizardId: string;
  wizard: Wizard;
  /** Parsed + schema-validated input for submit handlers. */
  input: Record<string, unknown>;
  /** Uploaded file for `upload` steps. */
  file?: WizardUploadFile;
  req: Request;
  storage: typeof storageType;
  /**
   * Report incremental progress for a `run` step (0-100). Persists to
   * `wizard.data.progress[stepId]`, which the manifest surfaces so the
   * client can poll the load route (no bespoke poll route).
   */
  reportProgress: (percentComplete: number) => Promise<void>;
}

export interface WizardStepResult {
  /**
   * Shallow-merged into the TOP LEVEL of `wizard.data` by the dispatcher.
   * Bulk row output must NOT go here — write it to `wizard_report_data`
   * via `storage.wizards.saveReportData` instead.
   */
  data?: Record<string, unknown>;
  /** Optional new status for the wizard row. */
  status?: string;
}

/**
 * One step of a wizard plugin. The gating fields (`requiredComponent` /
 * `requiredPolicy`) are declared right here next to the handler, so a
 * reviewer can answer "who can invoke this step?" from the dispatcher
 * plus this declaration alone.
 */
export interface WizardStepHandler {
  id: string;
  name: string;
  description?: string;
  kind: WizardStepKind;
  /** Step-level component gate (on top of the plugin-level gate). */
  requiredComponent?: string;
  /** Step-level access-policy gate (on top of the plugin-level gate). */
  requiredPolicy?: string;
  /** JSON Schema for `form` steps, rendered client-side by SchemaForm. */
  schema?: JsonSchema;
  /**
   * Dynamic per-step schema computed from the live wizard row. When
   * present it wins over the static `schema` — the manifest surfaces the
   * resolved schema and the dispatcher validates submits against it. Use
   * this when a form's options depend on earlier steps (e.g. the map step
   * of a feed wizard whose fields are the just-uploaded file's columns).
   */
  getSchema?: (wizard: Wizard) => JsonSchema | undefined;
  /** Optional RJSF uiSchema companion to `schema`. */
  uiSchema?: Record<string, unknown>;
  /**
   * Escape-hatch component name for `run` / `results` / `custom` steps.
   * The dispatcher fully-qualifies it as `<wizardType>:<ComponentName>`
   * for the client component registry to resolve.
   */
  component?: string;
  /** Handler for `form` / `review` / `upload` steps (synchronous work). */
  submit?: (
    ctx: WizardStepContext,
  ) => Promise<WizardStepResult> | WizardStepResult;
  /** Handler for `run` steps (async background work; reports progress). */
  run?: (
    ctx: WizardStepContext,
  ) => Promise<WizardStepResult | void> | WizardStepResult | void;
  /**
   * Generic computed step output, read via GET .../dispatch/:stepId/data
   * and exported via .../export. When present the dispatcher calls it and
   * returns its payload verbatim; the payload should carry `columns` and
   * `records` for the shared table + CSV export. When omitted, only
   * `results`-kind steps expose data (from the persisted report rows).
   * This lets feed/custom steps surface computed data through the SAME
   * generic route instead of any wizard-specific endpoint.
   */
  getData?: (
    ctx: WizardStepContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * Server-computed completion state, derived from the wizard row. When
   * omitted, the dispatcher derives a default from progress + currentStep.
   */
  getState?: (wizard: Wizard) => WizardStepState;
}

/**
 * A launch argument collected up-front when a wizard is created (before any
 * step runs) — e.g. the reporting year + month for a monthly feed. The
 * create route validates required arguments generically from this
 * declaration; the client renders inputs from the same list served off the
 * `/api/wizard-types/:type/launch-arguments` route.
 */
export interface LaunchArgument {
  id: string;
  name: string;
  /** UI hint: "text" | "number" | "select" | "month" | "year" | ... */
  type: string;
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
  options?: Array<{ value: unknown; label: string }>;
}

/**
 * Context handed to a plugin's custom `create` hook. `input` is the
 * schema-parsed create payload (with the first step + progress already
 * seeded by the create route). All persistence goes through `storage`.
 */
export interface WizardCreateContext {
  input: Record<string, unknown> & {
    type: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  };
  req: Request;
  storage: typeof storageType;
}

/**
 * Result of a custom `create` hook. Return `{ wizard }` on success or
 * `{ error, status }` to reject (the create route maps these to the HTTP
 * response). This is where per-wizard creation side effects live (e.g. the
 * monthly wizard's duplicate check + `wizard_employer_monthly` row) so the
 * generic create route stays free of wizard-specific branches.
 */
export interface WizardCreateResult {
  wizard?: Wizard;
  error?: string;
  status?: number;
}

export interface WizardPlugin extends BasePluginMetadata {
  /** Matches wizard.entityType semantics (e.g. "employer"). */
  entityType?: string;
  category?: string;
  /** Report-style wizard: gets a default retention + a Retention tab. */
  isReport?: boolean;
  /**
   * Up-front arguments collected at creation. The create route validates
   * the `required` ones generically before the wizard is persisted.
   */
  launchArguments?: LaunchArgument[];
  /**
   * Optional custom creation hook. When present, the create route calls it
   * INSTEAD of the default `storage.wizards.create`, after generic gating,
   * entity-access, and launch-argument validation. Use it for per-wizard
   * creation side effects (duplicate/prerequisite checks, subsidiary rows).
   */
  create?: (
    ctx: WizardCreateContext,
  ) => Promise<WizardCreateResult> | WizardCreateResult;
  steps: WizardStepHandler[];
}

/** A single step as surfaced in the computed manifest. */
export interface WizardStepManifestEntry {
  id: string;
  name: string;
  description?: string;
  kind: WizardStepKind;
  schema?: JsonSchema;
  uiSchema?: Record<string, unknown>;
  /** Fully-qualified "<wizardType>:<ComponentName>" for the escape hatch. */
  component?: string;
  state: WizardStepState;
  requiredComponent?: string;
  requiredPolicy?: string;
  progress?: {
    status?: string;
    percentComplete?: number;
    error?: string;
  };
}

/** Computed manifest attached to the wizard load route when registered. */
export interface WizardManifest {
  wizardType: string;
  displayName: string;
  description: string;
  isReport: boolean;
  currentStep: string;
  steps: WizardStepManifestEntry[];
}

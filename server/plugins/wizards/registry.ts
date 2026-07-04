import { PluginRegistry } from "../_core";
import type { BasePluginMetadata } from "../_core";
import type { Wizard } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepManifestEntry,
  WizardStepState,
  WizardManifest,
} from "./types";

/**
 * Manifest entry for the unified `/api/plugins/:kind/manifest` listing.
 * The dispatcher and the wizard-creation flow use `computeManifest`
 * (the per-instance view) instead; this flat shape is only the "what
 * wizard kinds exist" listing.
 */
export interface WizardManifestEntry extends BasePluginMetadata {
  entityType?: string;
  category?: string;
  isReport: boolean;
  steps: Array<{
    id: string;
    name: string;
    description?: string;
    kind: string;
  }>;
}

function pluginToMetadata(p: WizardPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
    needsReadOnlyDb: p.needsReadOnlyDb,
  };
}

function pluginToManifestEntry(p: WizardPlugin): WizardManifestEntry {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    needsReadOnlyDb: p.needsReadOnlyDb,
    entityType: p.entityType,
    category: p.category,
    isReport: p.isReport ?? false,
    steps: p.steps.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      kind: s.kind,
    })),
  };
}

/**
 * Registry for the sixth plugin kind: wizards. Reuses the shared
 * `PluginRegistry` scaffolding (registration, lookup, component /
 * access-policy gating, manifest listing) and adds the per-instance
 * manifest computation the fixed dispatcher route set relies on.
 */
export class WizardPluginRegistry extends PluginRegistry<
  WizardPlugin,
  WizardManifestEntry
> {
  constructor() {
    super({
      kind: "wizard",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
    });
  }

  getStep(plugin: WizardPlugin, stepId: string): WizardStepHandler | undefined {
    return plugin.steps.find((s) => s.id === stepId);
  }

  firstStepId(plugin: WizardPlugin): string | undefined {
    return plugin.steps[0]?.id;
  }

  /**
   * Resolve the plugin's up-front launch schema (inputs collected before
   * any step runs). `getLaunchSchema` wins over the static `launchSchema`.
   * Returns `undefined` when the wizard collects no launch inputs.
   */
  resolveLaunchSchema(
    plugin: WizardPlugin,
  ): { schema: JsonSchema; uiSchema?: Record<string, unknown> } | undefined {
    const schema = plugin.getLaunchSchema
      ? plugin.getLaunchSchema()
      : plugin.launchSchema;
    if (!schema) return undefined;
    return { schema, uiSchema: plugin.launchUiSchema };
  }

  /**
   * Server-computed completion state for a single step. A step's own
   * `getState` wins; otherwise we derive a sensible default from the
   * persisted progress and the current step.
   */
  stepState(
    plugin: WizardPlugin,
    step: WizardStepHandler,
    wizard: Wizard,
  ): WizardStepState {
    if (step.getState) return step.getState(wizard);
    const data = (wizard.data as any) || {};
    const p = data.progress?.[step.id];
    if (p?.status === "completed") return "completed";
    if (p?.status === "failed") return "failed";
    if (wizard.currentStep === step.id) return "in_progress";
    return "pending";
  }

  /** Build the per-instance manifest attached to the wizard load route. */
  computeManifest(plugin: WizardPlugin, wizard: Wizard): WizardManifest {
    const data = (wizard.data as any) || {};
    const currentStep =
      wizard.currentStep || this.firstStepId(plugin) || "";
    const steps: WizardStepManifestEntry[] = plugin.steps.map((step) => {
      const progress = data.progress?.[step.id];
      return {
        id: step.id,
        name: step.name,
        description: step.description,
        kind: step.kind,
        schema: step.getSchema ? step.getSchema(wizard) : step.schema,
        uiSchema: step.uiSchema,
        component: step.component
          ? `${plugin.id}:${step.component}`
          : undefined,
        state: this.stepState(plugin, step, wizard),
        requiredComponent: step.requiredComponent,
        requiredPolicy: step.requiredPolicy,
        progress: progress
          ? {
              status: progress.status,
              percentComplete: progress.percentComplete,
              error: progress.error,
            }
          : undefined,
      };
    });
    return {
      wizardType: plugin.id,
      displayName: plugin.name,
      description: plugin.description,
      isReport: plugin.isReport ?? false,
      currentStep,
      steps,
    };
  }
}

export const wizardPluginRegistry = new WizardPluginRegistry();

/** Convenience helper for plugin files to self-register at module load. */
export function registerWizardPlugin(plugin: WizardPlugin): void {
  wizardPluginRegistry.register(plugin);
}

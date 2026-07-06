import { createPluginComponentRegistry } from "@/plugins/_core/registry";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import type { Wizard } from "@/lib/wizard-types";

/**
 * Escape-hatch component registry for wizard steps. Any wizard whose
 * step declares a `component` gets its React component auto-discovered
 * here: drop `client/src/plugins/wizards/<wizardType>/<ComponentName>.tsx`
 * exporting a function named `<ComponentName>` and it resolves as
 * `<wizardType>:<ComponentName>`. The glob is evaluated at this call
 * site because Vite requires a static pattern.
 */
export const wizardComponentRegistry =
  createPluginComponentRegistry<WizardStepComponentProps>({
    kind: "wizards",
    glob: import.meta.glob("./*/*.tsx", { eager: true }),
  });

/**
 * Props handed to a bespoke launch component (the launcher escape hatch).
 * The default path — the schema-driven `WizardLauncher` — never uses this.
 * A wizard that needs launch UX beyond an auto-generated schema form drops
 * `client/src/plugins/wizards/<wizardType>/Launch.tsx` exporting a function
 * named `Launch`; the launcher resolves it as `<wizardType>:Launch` and
 * hands over full control of the launch UI.
 */
export interface WizardLaunchComponentProps {
  /** Wizard plugin id being launched. */
  type: string;
  /** Owning entity id for entity-scoped wizards. */
  entityId?: string | null;
  /** Pre-filled launch-input values. */
  defaults?: Record<string, unknown>;
  /** Called with the created wizard (defaults to navigate-to-wizard). */
  onCreated?: (wizard: Wizard) => void;
  /** Optional cancel action (e.g. to close a parent dialog). */
  onCancel?: () => void;
}

/**
 * Escape-hatch registry for bespoke launch components, keyed the same way
 * as wizard step components (`<wizardType>:Launch`). Shares the wizard
 * plugin folder glob; `WizardLauncher` consults it before falling back to
 * the generic schema-driven launch flow.
 */
export const wizardLaunchComponentRegistry =
  createPluginComponentRegistry<WizardLaunchComponentProps>({
    kind: "wizards",
    glob: import.meta.glob("./*/*.tsx", { eager: true }),
  });

import { createPluginComponentRegistry } from "@/plugins/_core/registry";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

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

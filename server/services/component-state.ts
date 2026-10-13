import { storage } from "../storage";
import { runOutsideTransaction } from "../storage/transaction-context";
import { getAllComponents, type ComponentConfig, type ComponentDefinition } from "../../shared/components";

export type ComponentEnabledMap = Record<string, boolean>;
export const COMPONENTS_VARIABLE_NAME = "components";

/**
 * One committed storage snapshot. Deliberately independent of the runtime
 * cache, its initialization, revision, and change listeners.
 */
export async function readComponentStateFromStorage(): Promise<{
  state: ComponentEnabledMap;
  version: string | undefined;
}> {
  const read = runOutsideTransaction(() => storage.variables.getJsonState(COMPONENTS_VARIABLE_NAME));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const variable = await Promise.race([
    read,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Component state read timed out after 5 seconds")), 5_000);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  // Only an absent row means no overrides. A present malformed row is an error.
  const value = variable === undefined ? {} : variable.value;
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.values(value).some(flag => typeof flag !== "boolean")) {
    throw new Error("The components variable must be an object of boolean flags");
  }
  return Object.freeze({
    state: Object.freeze({ ...value }) as ComponentEnabledMap,
    version: variable?.version,
  });
}

export function resolveComponentEnabled(component: ComponentDefinition, state: ComponentEnabledMap): boolean {
  return Object.hasOwn(state, component.id) ? state[component.id] : component.enabledByDefault;
}

export async function getComponentConfigsFromStorage(): Promise<ComponentConfig[]> {
  const { state } = await readComponentStateFromStorage();
  return getAllComponents().map(component => ({
    componentId: component.id,
    enabled: resolveComponentEnabled(component, state),
    definition: component,
  }));
}

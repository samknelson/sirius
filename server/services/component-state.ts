import { storage } from "../storage";
import { readConfigurationSnapshot } from "../storage/configuration-revisions";
import { getAllComponents, type ComponentConfig, type ComponentDefinition } from "../../shared/components";
import { getAbsentPackageComponents } from "./component-package-ownership";
import { componentPackageIds } from "@shared/generated/component-packages";

export type ComponentEnabledMap = Record<string, boolean>;
export const COMPONENTS_VARIABLE_NAME = "components";

async function boundedComponentRead<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    read,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Component state read timed out after 5 seconds")), 5_000);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * One committed storage snapshot. Deliberately independent of the runtime
 * cache, its initialization, revision, and change listeners.
 */
export async function readComponentStateFromStorage(): Promise<{
  state: ComponentEnabledMap;
  version: string | undefined;
}> {
  const read = readConfigurationSnapshot(() => storage.variables.getJsonState(COMPONENTS_VARIABLE_NAME));
  const variable = await boundedComponentRead(read);
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
  const [{ state }, absentComponents] = await Promise.all([
    readComponentStateFromStorage(),
    boundedComponentRead(readConfigurationSnapshot(() => getAbsentPackageComponents())),
  ]);
  const installed = getAllComponents().map(component => ({
    componentId: component.id,
    enabled: resolveComponentEnabled(component, state),
    configuredEnabled: resolveComponentEnabled(component, state),
    installed: true,
    packageId: componentPackageIds[component.id],
    definition: component,
  }));
  const absent: ComponentConfig[] = absentComponents.map(([id, owner]) => ({
    componentId: id, enabled: false, configuredEnabled: Object.hasOwn(state, id) ? state[id] : owner.definition.enabledByDefault,
    installed: false, packageId: owner.packageId, definition: owner.definition,
  }));
  const known = new Set([...installed, ...absent].map(c => c.componentId));
  // Even settings saved before ownership recording was introduced remain
  // visible, but never turn an unknown component into an installed one.
  for (const id of Object.keys(state)) if (!known.has(id)) absent.push({
    componentId: id, enabled: false, configuredEnabled: state[id], installed: false,
    definition: { id, name: id, description: "Retained settings; component package is not installed.", enabledByDefault: false },
  });
  return [...installed, ...absent];
}

import { storage } from "../storage";
import { getAllComponents, getComponentById } from "../../shared/components";
import { logger } from "../logger";

export type ComponentEnabledMap = Record<string, boolean>;

const COMPONENTS_VARIABLE_NAME = "components";

let cachedComponentState: ComponentEnabledMap | null = null;
let cacheInitialized = false;
let cacheRevision = 0;

/**
 * Bumped whenever the cached component state changes. Anything that
 * derives a cache from which plugins are component-enabled keys itself
 * on this, so enabling a component can't leave a stale derived cache
 * behind (e.g. a token field catalog that then rejects at delivery time
 * what validation accepted).
 */
export function getComponentCacheRevision(): number {
  return cacheRevision;
}

export async function loadComponentCache(): Promise<ComponentEnabledMap> {
  const variable = await storage.variables.getByName(COMPONENTS_VARIABLE_NAME);
  
  if (variable && typeof variable.value === "object" && variable.value !== null) {
    cachedComponentState = variable.value as ComponentEnabledMap;
  } else {
    cachedComponentState = {};
  }
  
  cacheInitialized = true;
  cacheRevision++;
  logger.debug("Component cache loaded", { 
    service: "component-cache",
    componentCount: Object.keys(cachedComponentState).length 
  });
  
  return cachedComponentState;
}

export function getComponentCache(): ComponentEnabledMap {
  if (!cacheInitialized || cachedComponentState === null) {
    throw new Error("Component cache not initialized. Call loadComponentCache() first.");
  }
  return cachedComponentState;
}

export function isCacheInitialized(): boolean {
  return cacheInitialized;
}

export function invalidateComponentCache(): void {
  cachedComponentState = null;
  cacheInitialized = false;
  cacheRevision++;
  logger.debug("Component cache invalidated", { service: "component-cache" });
}

export async function updateComponentCache(componentId: string, enabled: boolean): Promise<void> {
  if (!cacheInitialized) {
    await loadComponentCache();
  }
  
  cachedComponentState = cachedComponentState || {};
  cachedComponentState[componentId] = enabled;
  cacheRevision++;
  
  const existingVariable = await storage.variables.getByName(COMPONENTS_VARIABLE_NAME);
  
  if (existingVariable) {
    await storage.variables.update(existingVariable.id, {
      name: COMPONENTS_VARIABLE_NAME,
      value: cachedComponentState
    });
  } else {
    await storage.variables.create({
      name: COMPONENTS_VARIABLE_NAME,
      value: cachedComponentState
    });
  }
  
  logger.debug("Component cache updated", { 
    service: "component-cache",
    componentId,
    enabled 
  });
}

export function isComponentEnabledSync(componentId: string): boolean {
  if (!cacheInitialized || cachedComponentState === null) {
    throw new Error("Component cache not initialized. Call loadComponentCache() first.");
  }
  
  const component = getComponentById(componentId);
  if (!component) {
    return false;
  }

  return cachedComponentState[componentId] ?? component.enabledByDefault;
}

export function getEnabledComponentIdsSync(): string[] {
  if (!cacheInitialized || cachedComponentState === null) {
    throw new Error("Component cache not initialized. Call loadComponentCache() first.");
  }
  
  const allComponents = getAllComponents();
  const enabledIds: string[] = [];

  for (const component of allComponents) {
    if (isComponentEnabledSync(component.id)) {
      enabledIds.push(component.id);
    }
  }

  return enabledIds;
}


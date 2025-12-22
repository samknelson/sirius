import { storage } from "../storage";
import { getAllComponents, getComponentById, getAncestorComponentIds } from "../../shared/components";
import { logger } from "../logger";

export type ComponentEnabledMap = Record<string, boolean>;

const COMPONENTS_VARIABLE_NAME = "components";

let cachedComponentState: ComponentEnabledMap | null = null;
let cacheInitialized = false;

export async function loadComponentCache(): Promise<ComponentEnabledMap> {
  const variable = await storage.variables.getByName(COMPONENTS_VARIABLE_NAME);
  
  if (variable && typeof variable.value === "object" && variable.value !== null) {
    cachedComponentState = variable.value as ComponentEnabledMap;
  } else {
    cachedComponentState = {};
  }
  
  cacheInitialized = true;
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
  logger.debug("Component cache invalidated", { service: "component-cache" });
}

export async function updateComponentCache(componentId: string, enabled: boolean): Promise<void> {
  if (!cacheInitialized) {
    await loadComponentCache();
  }
  
  cachedComponentState = cachedComponentState || {};
  cachedComponentState[componentId] = enabled;
  
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

  const ancestors = getAncestorComponentIds(componentId);
  for (const ancestorId of ancestors) {
    const ancestorComponent = getComponentById(ancestorId);
    if (!ancestorComponent) {
      continue;
    }
    
    const ancestorEnabled = cachedComponentState[ancestorId] ?? ancestorComponent.enabledByDefault;
    if (!ancestorEnabled) {
      return false;
    }
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


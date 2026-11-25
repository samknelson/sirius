import { storage } from "../../storage";
import { getAllComponents, getComponentById } from "../../../shared/components";
import { logger } from "../../logger";
import { isInTransaction, onAfterCommit } from "../../storage/transaction-context";
import { COMPONENTS_VARIABLE_NAME, readComponentStateFromStorage, resolveComponentEnabled, type ComponentEnabledMap } from "./state";
export type { ComponentEnabledMap } from "./state";

let cachedComponentState: ComponentEnabledMap | null = null;
let cacheInitialized = false;
let cacheRevision = 0;
let readSequence = 0;
let publishedSequence = 0;
let persistedVersion: string | undefined;
const changeListeners = new Set<() => void>();
let watcher: ReturnType<typeof setInterval> | undefined;

export function onComponentCacheChange(listener: () => void): void {
  changeListeners.add(listener);
}

/** Infrastructure cache refresh, not a plugin cron: also runs in api-ws processes. */
export function startComponentCacheRefresh(): void {
  if (watcher) return;
  let refreshing = false;
  watcher = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void loadComponentCache().catch(error => {
      logger.warn("Component state refresh failed", { service: "component-cache", error: String(error) });
    }).finally(() => { refreshing = false; });
  }, 5_000);
  watcher.unref();
}

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
  const sequence = ++readSequence;
  let version: string | undefined;
  let state: ComponentEnabledMap;
  try {
    ({ state, version } = await readComponentStateFromStorage());
  } catch (error) {
    // A failed refresh means "unknown", not "disabled" or "use defaults".
    // Invalidate sync gates too; an earlier failure cannot undo a newer good read.
    if (sequence >= publishedSequence) {
      publishedSequence = sequence;
      if (cacheInitialized) cacheRevision++;
      cacheInitialized = false;
      cachedComponentState = null;
    }
    throw error;
  }
  // A slow earlier read cannot undo a later confirmed read.
  if (sequence >= publishedSequence) {
    publishedSequence = sequence;
    const changed = !cacheInitialized || cachedComponentState === null || persistedVersion !== version ||
      Object.keys(state).length !== Object.keys(cachedComponentState).length ||
      Object.entries(state).some(([id, flag]) => cachedComponentState![id] !== flag);
    cachedComponentState = state;
    persistedVersion = version;
    cacheInitialized = true;
    if (changed) {
      cacheRevision++;
      for (const listener of changeListeners) listener();
      logger.debug("Component cache refreshed", {
        service: "component-cache", componentCount: Object.keys(state).length,
      });
    }
  }
  return getComponentCache();
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
  publishedSequence = ++readSequence;
  cachedComponentState = null;
  cacheInitialized = false;
  cacheRevision++;
  logger.debug("Component cache invalidated", { service: "component-cache" });
}

export async function updateComponentCache(componentId: string, enabled: boolean): Promise<void> {
  await storage.variables.upsertJsonBooleanKey(COMPONENTS_VARIABLE_NAME, componentId, enabled);
  if (isInTransaction()) {
    onAfterCommit(() => {
      void loadComponentCache().catch(error => {
        logger.warn("Committed component state could not be refreshed", {
          service: "component-cache", componentId, error: String(error),
        });
      });
    });
  } else {
    await loadComponentCache();
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

  return resolveComponentEnabled(component, cachedComponentState);
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


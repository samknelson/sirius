export const CONFIGURATION_MENU_STORAGE_KEY = "configuration-menu-open";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

function browserStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage;
  } catch {
    // Browsers can deny access to the property itself, before getItem is called.
    return undefined;
  }
}

export function loadConfigurationMenuOpen(
  storage: StorageReader | undefined = browserStorage(),
): boolean {
  try {
    return storage?.getItem(CONFIGURATION_MENU_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveConfigurationMenuOpen(
  open: boolean,
  storage: StorageWriter | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(CONFIGURATION_MENU_STORAGE_KEY, String(open));
  } catch {
    // A blocked or full localStorage must not make the navigation unusable.
  }
}

export interface ConfigurationSectionOpenState {
  location: string;
  activeSectionIds: string;
  openSections: Record<string, boolean>;
}

function activeIdsKey(activeSectionIds: readonly string[]): string {
  return [...activeSectionIds].sort().join("\u0000");
}

/**
 * Active ancestors start open on the first render of a location. Their value is
 * then ordinary state, so a user can collapse an active group. Moving to a new
 * location opens its active ancestors again without resetting any other group.
 */
export function createConfigurationSectionOpenState(
  location: string,
  activeSectionIds: readonly string[],
): ConfigurationSectionOpenState {
  return {
    location,
    activeSectionIds: activeIdsKey(activeSectionIds),
    openSections: Object.fromEntries(activeSectionIds.map(id => [id, true])),
  };
}

export function reconcileConfigurationSectionNavigation(
  state: ConfigurationSectionOpenState,
  location: string,
  activeSectionIds: readonly string[],
  topLevelSectionIds: readonly string[],
): ConfigurationSectionOpenState {
  const nextActiveIds = activeIdsKey(activeSectionIds);
  if (state.location === location && state.activeSectionIds === nextActiveIds) {
    return state;
  }

  const openSections = { ...state.openSections };
  const activeTopLevelId = activeSectionIds.find(id => topLevelSectionIds.includes(id));
  if (activeTopLevelId) {
    for (const id of topLevelSectionIds) {
      if (id !== activeTopLevelId) openSections[id] = false;
    }
  }
  for (const sectionId of activeSectionIds) openSections[sectionId] = true;

  return {
    location,
    activeSectionIds: nextActiveIds,
    openSections,
  };
}

export function toggleConfigurationSection(
  state: ConfigurationSectionOpenState,
  sectionId: string,
  topLevelSectionIds: readonly string[],
): ConfigurationSectionOpenState {
  const openSections = { ...state.openSections };
  if (topLevelSectionIds.includes(sectionId) && !openSections[sectionId]) {
    for (const id of topLevelSectionIds) {
      if (id !== sectionId) openSections[id] = false;
    }
  }
  openSections[sectionId] = !openSections[sectionId];
  return {
    ...state,
    openSections,
  };
}
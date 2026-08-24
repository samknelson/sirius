import { storage } from "../storage";

export type SystemMode = "dev" | "test" | "live" | "maintenance";

const VALID_MODES: readonly SystemMode[] = ["dev", "test", "live", "maintenance"];

export async function getSystemMode(): Promise<SystemMode> {
  try {
    const modeVar = await storage.variables.getByName("system_mode");
    if (modeVar && typeof modeVar.value === "string") {
      const mode = modeVar.value as string;
      if ((VALID_MODES as readonly string[]).includes(mode)) {
        return mode as SystemMode;
      }
    }
    return "dev";
  } catch (error) {
    console.error("Failed to get system mode, defaulting to 'dev':", error);
    return "dev";
  }
}

export function isDevMode(mode: SystemMode): boolean {
  return mode === "dev";
}

export function isTestMode(mode: SystemMode): boolean {
  return mode === "test";
}

export function isLiveMode(mode: SystemMode): boolean {
  return mode === "live";
}

/**
 * Maintenance mode: the app's database connections are read-only
 * (see server/services/maintenance-mode.ts). Reads and browsing work
 * normally; every write from the server process fails at the Postgres
 * level unless it goes through `allowInMaintenanceMode`.
 */
export function isMaintenanceMode(mode: SystemMode): boolean {
  return mode === "maintenance";
}

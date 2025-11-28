import { storage } from "../storage";

export type SystemMode = "dev" | "test" | "live";

export async function getSystemMode(): Promise<SystemMode> {
  try {
    const modeVar = await storage.variables.getByName("system_mode");
    if (modeVar && typeof modeVar.value === "string") {
      const mode = modeVar.value as string;
      if (mode === "dev" || mode === "test" || mode === "live") {
        return mode;
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

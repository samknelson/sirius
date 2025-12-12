import { registerFloodEvent, floodEventRegistry } from "./registry";
import { FloodEventDefinition, FloodContext } from "./types";
import { storage } from "../storage";
import { logger } from "../logger";

export const bookmarkFloodEvent: FloodEventDefinition = {
  name: "bookmark",
  threshold: 1000,
  windowSeconds: 360,
  getIdentifier: (context: FloodContext): string => {
    if (!context.userId) {
      throw new Error("userId is required for bookmark flood event");
    }
    return context.userId;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    try {
      const user = await storage.users.getUser(identifier);
      if (user) {
        return user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`.trim()
          : user.email || null;
      }
      return null;
    } catch {
      return null;
    }
  },
};

export function registerFloodEvents(): void {
  registerFloodEvent(bookmarkFloodEvent);
}

export async function loadFloodConfigFromVariables(): Promise<void> {
  const definitions = floodEventRegistry.getAllDefinitions();
  
  for (const def of definitions) {
    const variableName = `flood_${def.name}`;
    try {
      const variable = await storage.variables.getByName(variableName);
      if (variable?.value) {
        const config = typeof variable.value === 'string' 
          ? JSON.parse(variable.value) 
          : variable.value;
        
        if (config.threshold && config.windowSeconds) {
          floodEventRegistry.updateConfig(def.name, config.threshold, config.windowSeconds);
          logger.info(`Loaded custom flood config for "${def.name}"`, {
            service: 'flood-config',
            threshold: config.threshold,
            windowSeconds: config.windowSeconds,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to load flood config for "${def.name}"`, {
        service: 'flood-config',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

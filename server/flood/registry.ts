import { FloodEventDefinition } from "./types";
import { logger } from "../logger";

interface FloodEventDefaults {
  threshold: number;
  windowSeconds: number;
}

class FloodEventRegistry {
  private events: Map<string, FloodEventDefinition> = new Map();
  private defaults: Map<string, FloodEventDefaults> = new Map();

  register(event: FloodEventDefinition): void {
    if (this.events.has(event.name)) {
      throw new Error(`Flood event "${event.name}" is already registered`);
    }
    this.events.set(event.name, event);
    this.defaults.set(event.name, {
      threshold: event.threshold,
      windowSeconds: event.windowSeconds,
    });
    logger.info(`Registered flood event: ${event.name}`, { 
      service: 'flood-registry',
      threshold: event.threshold,
      windowSeconds: event.windowSeconds,
    });
  }

  get(name: string): FloodEventDefinition | undefined {
    return this.events.get(name);
  }

  has(name: string): boolean {
    return this.events.has(name);
  }

  getAll(): FloodEventDefinition[] {
    return Array.from(this.events.values());
  }

  getAllDefinitions(): { name: string; threshold: number; windowSeconds: number }[] {
    return Array.from(this.events.values()).map(e => ({
      name: e.name,
      threshold: e.threshold,
      windowSeconds: e.windowSeconds,
    }));
  }

  updateConfig(name: string, threshold: number, windowSeconds: number): boolean {
    const event = this.events.get(name);
    if (!event) return false;
    event.threshold = threshold;
    event.windowSeconds = windowSeconds;
    return true;
  }

  resetToDefaults(name: string): boolean {
    const event = this.events.get(name);
    const defaultConfig = this.defaults.get(name);
    if (!event || !defaultConfig) return false;
    event.threshold = defaultConfig.threshold;
    event.windowSeconds = defaultConfig.windowSeconds;
    return true;
  }

  getDefaults(name: string): FloodEventDefaults | undefined {
    return this.defaults.get(name);
  }

  async resolveIdentifierName(eventName: string, identifier: string): Promise<string | null> {
    const event = this.events.get(eventName);
    if (!event?.resolveIdentifierName) return null;
    return event.resolveIdentifierName(identifier);
  }

  async resolveIdentifierNames(
    events: Array<{ event: string; identifier: string }>
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const byEventType = new Map<string, Set<string>>();

    for (const { event, identifier } of events) {
      if (!byEventType.has(event)) {
        byEventType.set(event, new Set());
      }
      byEventType.get(event)!.add(identifier);
    }

    for (const [eventName, identifiers] of Array.from(byEventType.entries())) {
      const eventDef = this.events.get(eventName);
      if (!eventDef?.resolveIdentifierName) continue;

      for (const identifier of Array.from(identifiers)) {
        const key = `${eventName}:${identifier}`;
        if (!results.has(key)) {
          try {
            const name = await eventDef.resolveIdentifierName(identifier);
            if (name) {
              results.set(key, name);
            }
          } catch {
            // Ignore resolution errors
          }
        }
      }
    }

    return results;
  }
}

export const floodEventRegistry = new FloodEventRegistry();

export function registerFloodEvent(event: FloodEventDefinition): void {
  floodEventRegistry.register(event);
}

export function getFloodEvent(name: string): FloodEventDefinition | undefined {
  return floodEventRegistry.get(name);
}

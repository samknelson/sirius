import { FloodEventDefinition } from "./types";
import { logger } from "../logger";

class FloodEventRegistry {
  private events: Map<string, FloodEventDefinition> = new Map();

  register(event: FloodEventDefinition): void {
    if (this.events.has(event.name)) {
      throw new Error(`Flood event "${event.name}" is already registered`);
    }
    this.events.set(event.name, event);
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
}

export const floodEventRegistry = new FloodEventRegistry();

export function registerFloodEvent(event: FloodEventDefinition): void {
  floodEventRegistry.register(event);
}

export function getFloodEvent(name: string): FloodEventDefinition | undefined {
  return floodEventRegistry.get(name);
}

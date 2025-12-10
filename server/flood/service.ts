import { floodEventRegistry } from "./registry";
import { FloodContext, FloodCheckResult } from "./types";
import { storage } from "../storage";
import { logger } from "../logger";

export class FloodError extends Error {
  public readonly eventName: string;
  public readonly count: number;
  public readonly threshold: number;
  public readonly windowSeconds: number;

  constructor(eventName: string, count: number, threshold: number, windowSeconds: number) {
    super(`Flood limit exceeded for event "${eventName}": ${count}/${threshold} in ${windowSeconds}s window`);
    this.name = "FloodError";
    this.eventName = eventName;
    this.count = count;
    this.threshold = threshold;
    this.windowSeconds = windowSeconds;
  }
}

export async function checkFlood(eventName: string, context: FloodContext): Promise<FloodCheckResult> {
  const event = floodEventRegistry.get(eventName);
  
  if (!event) {
    throw new Error(`Unknown flood event: ${eventName}`);
  }

  const identifier = event.getIdentifier(context);
  const windowStart = new Date(Date.now() - event.windowSeconds * 1000);
  
  const count = await storage.flood.countEventsInWindow(eventName, identifier, windowStart);

  return {
    allowed: count < event.threshold,
    count,
    threshold: event.threshold,
    windowSeconds: event.windowSeconds,
    identifier,
  };
}

export async function recordFloodEvent(eventName: string, context: FloodContext): Promise<void> {
  const event = floodEventRegistry.get(eventName);
  
  if (!event) {
    throw new Error(`Unknown flood event: ${eventName}`);
  }

  const identifier = event.getIdentifier(context);
  const expiresAt = new Date(Date.now() + event.windowSeconds * 1000);
  
  await storage.flood.recordFloodEvent(eventName, identifier, expiresAt);
}

export async function enforceFloodLimit(eventName: string, context: FloodContext): Promise<void> {
  const result = await checkFlood(eventName, context);
  
  if (!result.allowed) {
    logger.warn(`Flood limit exceeded`, {
      service: 'flood-service',
      event: eventName,
      identifier: result.identifier,
      count: result.count,
      threshold: result.threshold,
    });
    throw new FloodError(eventName, result.count, result.threshold, result.windowSeconds);
  }
  
  await recordFloodEvent(eventName, context);
}

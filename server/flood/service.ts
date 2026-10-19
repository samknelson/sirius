import { floodPluginRegistry } from "../plugins/system/flood/registry";
import { floodSettingsSchema } from "../plugins/system/flood/types";
import { isPluginComponentEnabledAsync } from "../plugins/_core/gating";
import { getConfigsForKind } from "../plugins/_core/plugin-config-cache";
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

async function resolveFlood(eventName: string) {
  const plugin = floodPluginRegistry.get(eventName);
  if (!plugin) throw new Error(`Unknown flood event: ${eventName}`);
  if (!(await isPluginComponentEnabledAsync(plugin))) {
    return { enabled: false as const, reason: "component-disabled" as const };
  }
  const configs = await getConfigsForKind("flood");
  const config = configs.find(row => row.config.pluginId === eventName)?.config;
  if (config && !config.enabled) {
    return { enabled: false as const, reason: "disabled" as const };
  }
  // Absence means code defaults, never an implicitly disabled core limiter.
  const settings = floodSettingsSchema.parse(config ? config.data : plugin.defaults);
  return { enabled: true as const, plugin, ...settings };
}

export async function checkFlood(eventName: string, context: FloodContext): Promise<FloodCheckResult> {
  const event = await resolveFlood(eventName);
  if (!event.enabled) return { allowed: true, skipped: true, reason: event.reason };

  const identifier = event.plugin.getIdentifier(context);
  const windowStart = new Date(Date.now() - event.windowSeconds * 1000);
  
  const count = await storage.flood.countEventsInWindow(eventName, identifier, windowStart);

  // Block when count >= threshold (the current request would be the threshold+1th event)
  // A count of threshold blocks the next action.
  return {
    allowed: count < event.threshold,
    count,
    threshold: event.threshold,
    windowSeconds: event.windowSeconds,
    identifier,
  };
}

export async function recordFloodEvent(eventName: string, context: FloodContext): Promise<void> {
  const event = await resolveFlood(eventName);
  if (!event.enabled) return;

  const identifier = event.plugin.getIdentifier(context);
  const expiresAt = new Date(Date.now() + event.windowSeconds * 1000);
  
  await storage.flood.recordFloodEvent(eventName, identifier, expiresAt);
}

export async function enforceFloodLimit(eventName: string, context: FloodContext): Promise<void> {
  const result = await checkFlood(eventName, context);
  if (result.skipped) return;
  
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

/** Historical/retired identifiers always remain viewable even without a label. */
export async function resolveFloodIdentifierNames(
  events: Array<{ event: string; identifier: string }>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const byEvent = new Map<string, Set<string>>();
  for (const row of events) {
    if (!byEvent.has(row.event)) byEvent.set(row.event, new Set());
    byEvent.get(row.event)!.add(row.identifier);
  }
  for (const [name, identifiers] of byEvent) {
    try {
      if (!floodPluginRegistry.has(name)) continue;
      const resolved = await resolveFlood(name);
      if (!resolved.enabled || !resolved.plugin.resolveIdentifierName) continue;
      for (const identifier of identifiers) {
        try {
          const label = await resolved.plugin.resolveIdentifierName(identifier);
          if (label) results.set(`${name}:${identifier}`, label);
        } catch { /* Raw identifiers remain the safe history fallback. */ }
      }
    } catch { /* Configuration/component failures must not hide history. */ }
  }
  return results;
}

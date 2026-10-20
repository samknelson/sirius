import { floodPluginRegistry } from "../plugins/system/flood/registry";
import { floodSettingsSchema, type FloodPlugin } from "../plugins/system/flood/types";
import { isPluginComponentEnabledAsync } from "../plugins/_core/gating";
import { getConfigsForKind, getEnabledConfigsForKind } from "../plugins/_core/plugin-config-cache";
import { ensureSingletonPluginConfig } from "../plugins/_core/singleton-seeder";
import type { FloodContext, FloodCheckResult } from "./types";
import type { PluginConfig } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";

export class FloodError extends Error {
  constructor(
    public eventName: string, public count: number, public threshold: number,
    public windowSeconds: number, public pluginConfigurationId?: string,
  ) {
    super(`Flood limit exceeded for ${eventName}: ${count}/${threshold} events in ${windowSeconds} seconds`);
    this.name = "FloodError";
  }
}
type ActiveFlood = {
  enabled: true; plugin: FloodPlugin; config: PluginConfig;
  threshold: number; windowSeconds: number;
};
type ResolvedFlood = ActiveFlood | { enabled: false; reason: "disabled" | "component-disabled" };

async function resolveConfig(plugin: FloodPlugin, config: PluginConfig): Promise<ResolvedFlood> {
  if (!(await isPluginComponentEnabledAsync(plugin))) return { enabled: false, reason: "component-disabled" };
  if (!config.enabled) return { enabled: false, reason: "disabled" };
  return { enabled: true, plugin, config, ...floodSettingsSchema.parse(config.data) };
}
async function resolveSingleton(eventName: string): Promise<ResolvedFlood> {
  const plugin = floodPluginRegistry.get(eventName);
  if (!plugin) throw new Error(`Unknown flood event: ${eventName}`);
  if (!plugin.singleton) throw new Error(`Flood plugin "${eventName}" requires a configuration instance`);
  if (!(await isPluginComponentEnabledAsync(plugin))) return { enabled: false, reason: "component-disabled" };
  const configs = await getConfigsForKind("flood");
  const config = configs.find(row => row.config.pluginId === eventName)?.config ??
    (await ensureSingletonPluginConfig("flood", eventName))?.config;
  if (!config) throw new Error(`No configuration or default for flood event: ${eventName}`);
  return resolveConfig(plugin, config);
}
async function checkResolved(event: ResolvedFlood, context: FloodContext): Promise<FloodCheckResult> {
  if (!event.enabled) return { allowed: true, skipped: true, reason: event.reason };
  const identifier = event.plugin.getIdentifier(context, event.config.data);
  const count = await storage.flood.countEventsInWindow(
    event.config.id, identifier, new Date(Date.now() - event.windowSeconds * 1000),
  );
  return {
    allowed: count < event.threshold, count, threshold: event.threshold,
    windowSeconds: event.windowSeconds, identifier, pluginConfigurationId: event.config.id,
  };
}
async function recordResolved(event: ActiveFlood, identifier: string): Promise<void> {
  await storage.flood.recordFloodEvent(
    event.config.id, event.plugin.id, identifier, new Date(Date.now() + event.windowSeconds * 1000),
  );
}
function refuse(eventName: string, result: FloodCheckResult): void {
  if (!result.allowed) throw new FloodError(
    eventName, result.count, result.threshold, result.windowSeconds, result.pluginConfigurationId,
  );
}
export async function checkFlood(eventName: string, context: FloodContext): Promise<FloodCheckResult> {
  return checkResolved(await resolveSingleton(eventName), context);
}
export async function recordFloodEvent(eventName: string, context: FloodContext): Promise<void> {
  const event = await resolveSingleton(eventName);
  if (event.enabled) await recordResolved(event, event.plugin.getIdentifier(context, event.config.data));
}
export async function enforceFloodLimit(eventName: string, context: FloodContext): Promise<void> {
  const event = await resolveSingleton(eventName);
  const result = await checkResolved(event, context);
  if (result.skipped) return;
  if (!result.allowed) {
    logger.warn("Flood limit exceeded", { service: "flood-service", event: eventName,
      identifier: result.identifier, count: result.count, threshold: result.threshold });
    refuse(eventName, result);
  }
  if (event.enabled) await recordResolved(event, result.identifier);
}

/** Instance-based rules: preflight ALL matches before consuming any budget. */
export async function enforceConfiguredFloodLimits(context: FloodContext): Promise<void> {
  const { runOutsideTransaction } = await import("../storage/transaction-context");
  await runOutsideTransaction(async () => {
    const configs = await getEnabledConfigsForKind("flood");
    const permitted: Array<{ event: ActiveFlood; identifier: string }> = [];
    for (const { config } of configs) {
      const plugin = floodPluginRegistry.get(config.pluginId);
      if (!plugin?.matches || plugin.singleton || !config.enabled ||
          !(await isPluginComponentEnabledAsync(plugin)) || !plugin.matches(config.data, context)) continue;
      const event = await resolveConfig(plugin, config);
      if (!event.enabled) continue;
      const result = await checkResolved(event, context);
      refuse(plugin.id, result);
      if (!result.skipped) permitted.push({ event, identifier: result.identifier });
    }
    for (const { event, identifier } of permitted) await recordResolved(event, identifier);
  });
}

/** Historical labels are keyed by the configuration, not only the plugin type. */
export async function resolveFloodIdentifierNames(
  events: Array<{ event: string; identifier: string; pluginConfigurationId: string }>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let configs;
  try { configs = await getConfigsForKind("flood"); }
  catch { return results; }
  for (const row of events) {
    const key = `${row.pluginConfigurationId}:${row.identifier}`;
    if (results.has(key)) continue;
    const plugin = floodPluginRegistry.get(row.event);
    const config = configs.find(c => c.config.id === row.pluginConfigurationId)?.config;
    if (!plugin?.resolveIdentifierName || !config?.enabled) continue;
    try {
      if (!(await isPluginComponentEnabledAsync(plugin))) continue;
      const label = await plugin.resolveIdentifierName(row.identifier);
      if (label) results.set(key, label);
    } catch { /* Raw identifiers remain readable for retired/unavailable sources. */ }
  }
  return results;
}

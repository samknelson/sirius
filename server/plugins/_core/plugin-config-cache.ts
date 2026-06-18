import { eventBus, EventType, type PluginConfigSavedPayload } from "../../services/event-bus";
import { logger } from "../../logger";
import type { PluginConfigWithSubsidiary } from "../../storage/plugin-configs";

const SERVICE = "plugin-config-cache";

/**
 * Shared, in-memory cache of the *enabled* plugin configs for each kind. Any
 * plugin kind that needs to list its enabled configs hot-path (e.g. the
 * event-notifier dispatcher on every fired event) reads from here instead of
 * hitting the DB. Consumers filter the returned envelopes in memory — there are
 * never many configs of a given kind, so a linear scan per call is cheap.
 *
 * Invalidation is centralized: storage emits `PLUGIN_CONFIG_SAVED` on every
 * write, and the single subscription registered by {@link initializePluginConfigCache}
 * drops the affected kind's slice. Consumers never subscribe or invalidate
 * themselves.
 */
const cache = new Map<string, PluginConfigWithSubsidiary[]>();
const loading = new Map<string, Promise<PluginConfigWithSubsidiary[]>>();
const generation = new Map<string, number>();

async function build(kind: string): Promise<PluginConfigWithSubsidiary[]> {
  const { storage } = await import("../../storage");
  // Filter `enabled: true` in the DB so a growing pile of disabled configs
  // costs nothing here.
  const envelopes = await storage.pluginConfigs.search(kind, { enabled: true });
  logger.info("Plugin-config cache rebuilt", {
    service: SERVICE,
    kind,
    configs: envelopes.length,
  });
  return envelopes;
}

/**
 * The enabled configs for `kind`. Loads (and caches) the kind's slice on first
 * call; subsequent calls are pure in-memory reads until the slice is
 * invalidated by a config mutation. A per-kind generation counter guards
 * against an in-flight rebuild stamping stale data over a slice that was
 * invalidated while it was building.
 */
export async function getEnabledConfigsForKind(
  kind: string,
): Promise<PluginConfigWithSubsidiary[]> {
  const cached = cache.get(kind);
  if (cached) return cached;

  const inFlight = loading.get(kind);
  if (inFlight) return inFlight;

  const gen = generation.get(kind) ?? 0;
  const promise = build(kind)
    .then((built) => {
      // Only stamp the cache if no invalidation happened while building.
      if ((generation.get(kind) ?? 0) === gen) cache.set(kind, built);
      loading.delete(kind);
      return built;
    })
    .catch((error) => {
      loading.delete(kind);
      throw error;
    });
  loading.set(kind, promise);
  return promise;
}

/**
 * Drop a kind's cached slice so the next read rebuilds it from storage. Cheap
 * and synchronous — the rebuild is deferred to the next read so a burst of
 * edits coalesces into a single reload.
 */
export function invalidatePluginConfigCache(kind: string): void {
  cache.delete(kind);
  generation.set(kind, (generation.get(kind) ?? 0) + 1);
}

let initialized = false;

/**
 * Register the single bus subscription that keeps the shared cache fresh: every
 * `PLUGIN_CONFIG_SAVED` event (emitted from the storage layer on create /
 * update / delete) invalidates the affected kind's slice. Call once at boot;
 * re-running is a no-op. The cache itself stays lazy — this only wires
 * invalidation.
 */
export function initializePluginConfigCache(): void {
  if (initialized) return;
  eventBus.on({
    name: "plugin-config-cache:invalidate",
    description:
      "Invalidate the shared plugin-config cache slice for the saved kind.",
    event: EventType.PLUGIN_CONFIG_SAVED,
    handler: async (payload: PluginConfigSavedPayload) => {
      invalidatePluginConfigCache(payload.kind);
    },
  });
  initialized = true;
  logger.info("Plugin-config cache initialized", { service: SERVICE });
}

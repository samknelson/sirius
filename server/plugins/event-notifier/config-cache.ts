import { logger } from "../../logger";
import type { EventType } from "../../services/event-bus";
import { eventNotifierRegistry } from "./registry";
import type { NotificationMedium } from "./types";

const SERVICE = "event-notifier-config-cache";

/**
 * One enabled event-notifier config, reduced to exactly what the dispatcher
 * needs to fan an event out: which plugin to run and the admin's active media
 * selection. Component gating and the plugin's supportedMedia intersection
 * stay dynamic (resolved per emit in the dispatcher) because a component can
 * be toggled at runtime without touching any config row.
 */
export interface EventNotifierConfigEntry {
  configId: string;
  pluginId: string;
  media: NotificationMedium[];
}

/**
 * Pre-built index: event -> the enabled configs whose plugin subscribes to it.
 * `null` means "not loaded / invalidated"; it is rebuilt lazily on the next
 * read. A generation counter guards against an in-flight rebuild stamping
 * stale data over a cache that was invalidated while it was building.
 */
let index: Map<EventType, EventNotifierConfigEntry[]> | null = null;
let loading: Promise<Map<EventType, EventNotifierConfigEntry[]>> | null = null;
let generation = 0;

function parseMedia(value: unknown): NotificationMedium[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as NotificationMedium[];
}

/**
 * Non-blocking guard for the dual-source media problem: the authoritative
 * admin selection lives in the subsidiary `media` column, but a mirror is also
 * folded into `data.media` (so `validateConfig` can enforce the supportedMedia
 * subset). If the two drift apart something wrote one without the other; warn
 * so it is caught early. Compared as sets — order/format don't matter.
 */
function warnOnMediaDrift(
  configId: string,
  pluginId: string,
  subsidiaryMedia: NotificationMedium[],
  dataMedia: string[],
): void {
  const sub = new Set(subsidiaryMedia);
  const data = new Set(dataMedia.map((m) => String(m)));
  if (sub.size !== data.size || subsidiaryMedia.some((m) => !data.has(m))) {
    logger.warn("Event-notifier media drift between subsidiary and data.media", {
      service: SERVICE,
      configId,
      pluginId,
      subsidiaryMedia: Array.from(sub),
      dataMedia: Array.from(data),
    });
  }
}

/**
 * Query the enabled configs once and fold them into the event index. Filtering
 * by `enabled: true` happens in the DB so a growing pile of disabled configs
 * costs nothing here.
 */
async function build(): Promise<Map<EventType, EventNotifierConfigEntry[]>> {
  const { storage } = await import("../../storage");
  const envelopes = await storage.pluginConfigs.search("event-notifier", {
    enabled: true,
  });

  const next = new Map<EventType, EventNotifierConfigEntry[]>();
  for (const envelope of envelopes) {
    const subsidiary = envelope.subsidiary as { media?: string | null } | null;
    const media = parseMedia(subsidiary?.media);

    const data = (envelope.config.data ?? {}) as Record<string, unknown>;
    const dataMedia = Array.isArray(data.media)
      ? (data.media as unknown[]).filter((m): m is string => typeof m === "string")
      : [];
    warnOnMediaDrift(envelope.config.id, envelope.config.pluginId, media, dataMedia);

    if (media.length === 0) continue;
    const plugin = eventNotifierRegistry.get(envelope.config.pluginId);
    if (!plugin) continue;

    const entry: EventNotifierConfigEntry = {
      configId: envelope.config.id,
      pluginId: envelope.config.pluginId,
      media,
    };
    for (const event of plugin.subscribedEvents) {
      const list = next.get(event);
      if (list) list.push(entry);
      else next.set(event, [entry]);
    }
  }

  logger.info("Event-notifier config cache rebuilt", {
    service: SERVICE,
    events: next.size,
    configs: envelopes.length,
  });
  return next;
}

async function ensureLoaded(): Promise<Map<EventType, EventNotifierConfigEntry[]>> {
  if (index) return index;
  if (!loading) {
    const gen = generation;
    loading = build()
      .then((built) => {
        // Only cache if no invalidation happened while we were building.
        if (gen === generation) index = built;
        loading = null;
        return built;
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

/**
 * The enabled configs whose plugin subscribes to `event`. Loads (and caches)
 * the index on first call; subsequent calls are pure in-memory reads until the
 * cache is invalidated by a config mutation.
 */
export async function getEventNotifierConfigsForEvent(
  event: EventType,
): Promise<EventNotifierConfigEntry[]> {
  const idx = await ensureLoaded();
  return idx.get(event) ?? [];
}

/**
 * Drop the cached index so the next read rebuilds it from storage. Called after
 * any create/update/delete of an event-notifier config (via the adapter's
 * `onConfigChanged` hook). Cheap and synchronous — the rebuild is deferred to
 * the next emit so a burst of edits coalesces into a single reload.
 */
export function invalidateEventNotifierConfigCache(): void {
  index = null;
  generation++;
}

import { PluginRegistry } from "../_core";
import type {
  EventNotifierPlugin,
  EventNotifierManifestEntry,
} from "./types";

export const eventNotifierRegistry = new PluginRegistry<
  EventNotifierPlugin,
  EventNotifierManifestEntry
>({
  kind: "event-notifier",
  getMetadata: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
  }),
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    order: p.order ?? 100,
    requiredComponent: p.requiredComponent,
  }),
});

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerClientInjection` / `registerChargePlugin`.
 */
export function registerEventNotifier(plugin: EventNotifierPlugin): void {
  eventNotifierRegistry.register(plugin);
}

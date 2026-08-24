import { PluginRegistry } from "../_core";
// Submodule imports, not the tokens barrel: the barrel pulls in every
// token plugin, and a notifier plugin file is imported from it.
import {
  getTokenContextRoot,
  registerTokenContextRoot,
} from "../tokens/context-roots";
import { tokenPluginRegistry } from "../tokens/registry";
import { stampNotifierTemplateIds } from "./template-schema";
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
    needsReadOnlyDb: p.needsReadOnlyDb,
  }),
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    order: p.order ?? 100,
    requiredComponent: p.requiredComponent,
    needsReadOnlyDb: p.needsReadOnlyDb,
  }),
});

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerClientInjection` / `registerChargePlugin`.
 */
export function registerEventNotifier(plugin: EventNotifierPlugin): void {
  // Contract: a notifier composes messages EITHER via token templates
  // (framework-rendered) or via its own getMessage. A plugin with
  // neither would silently deliver nothing — fail loudly at boot.
  if (!plugin.tokenTemplates && typeof plugin.getMessage !== "function") {
    throw new Error(
      `Event notifier "${plugin.id}" must declare tokenTemplates or implement getMessage`,
    );
  }
  if (plugin.tokenTemplates) {
    registerRecordRoots(plugin);
    // The template cards address the catalog endpoint by plugin id, so
    // the id comes from the registration itself — never from a constant
    // the plugin file writes out a second time.
    //
    // No card to stamp means the notifier renders messages from token
    // templates that nobody can see or edit — the same silent nothing
    // this stamping exists to prevent. Fail at boot instead.
    if (stampNotifierTemplateIds(plugin.configSchema, plugin.id) === 0) {
      throw new Error(
        `Event notifier "${plugin.id}" declares tokenTemplates but its configSchema ` +
          `has no message-template channel groups; build the block with templatesSchemaBlock().`,
      );
    }
  }
  eventNotifierRegistry.register(plugin);
}

/**
 * Project a notifier's declared record roots into the token registry,
 * so its editor offers them and its templates validate against them.
 *
 * A root inherits the notifier's `requiredComponent`: a root about a
 * dispatch record must not exist when dispatch is off, since the tables
 * behind it need not exist at all.
 */
function registerRecordRoots(plugin: EventNotifierPlugin): void {
  const roots = plugin.tokenTemplates!.roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error(
      `Event notifier "${plugin.id}" declares tokenTemplates with no record roots; ` +
        `declare at least one root naming the record its messages are about.`,
    );
  }
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root.name)) {
      throw new Error(
        `Event notifier "${plugin.id}" declares the record root "${root.name}" twice.`,
      );
    }
    seen.add(root.name);
    // A name already taken by an ordinary root (contact, worker,
    // system) or by the event envelope would silently shadow it in this
    // editor and mean something else in the next one. Only a record
    // root ALREADY DECLARED as such (another notifier about the same
    // kind of record) may share a name — `registerTokenContextRoot`
    // decides whether the two declarations are compatible.
    if (!getTokenContextRoot(root.name)) {
      const clash = tokenPluginRegistry
        .list()
        .find(
          (p) =>
            p.metadata.segmentName === root.name &&
            p.metadata.inputTypes.includes("root"),
        );
      if (clash) {
        throw new Error(
          `Event notifier "${plugin.id}" declares the record root "${root.name}", ` +
            `which is already the "${clash.metadata.name}" root (${clash.metadata.id}). ` +
            `Pick a name that says what the record is.`,
        );
      }
    }
    registerTokenContextRoot({
      name: root.name,
      kind: root.kind,
      label: root.label,
      description: root.description,
      fields: root.fields,
      // A related record seeded alongside the notifier's own belongs to
      // whichever component owns its kind, not to the (often narrower)
      // component gating this notifier — see NotifierRecordRoot.
      requiredComponent: root.requiredComponent ?? plugin.requiredComponent,
    });
  }
}

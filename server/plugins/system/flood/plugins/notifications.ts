import { registerFloodPlugin } from "../registry";
import { NOTIFICATION_FLOOD_EVENTS } from "../../../../flood/constants";

async function resolveIdentifierName(identifier: string): Promise<string | null> {
  const [contactId, pluginId] = identifier.split("|");
  let contactLabel: string | null = null;
  let pluginLabel: string | null = pluginId || null;
  try {
    const { storage } = await import("../../../../storage");
    const contact = contactId ? await storage.contacts.getContact(contactId) : null;
    contactLabel = contact?.displayName || contact?.email || null;
  } catch { /* Keep the independently resolvable plugin label. */ }
  try {
    const { eventNotifierRegistry } = await import("../../../event-notifier/registry");
    pluginLabel = eventNotifierRegistry.get(pluginId)?.name ?? pluginLabel;
  } catch { /* Unknown/retired plugins retain their id. */ }
  return [contactLabel, pluginLabel].filter(Boolean).join(" · ") || null;
}

for (const [medium, id] of Object.entries(NOTIFICATION_FLOOD_EVENTS)) {
  registerFloodPlugin({
    id, name: `Notifications — ${medium}`, singleton: true,
    description: `Limits ${medium} notifications independently per recipient and notifier plugin. Other recipients, plugins and media have separate buckets.`,
    defaults: { threshold: 20, windowSeconds: 3600 },
    getIdentifier(context) {
      if (!context.contactId || !context.pluginId) {
        throw new Error(`contactId and pluginId are required for flood event "${id}"`);
      }
      return `${context.contactId}|${context.pluginId}`;
    },
    resolveIdentifierName,
  });
}

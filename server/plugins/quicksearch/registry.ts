import type { JsonSchema } from "@shared/json-schema-form";
import { PluginRegistry } from "../_core";
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import type {
  QuicksearchPlugin,
  QuicksearchManifestEntry,
  QuicksearchUiSchema,
} from "./types";

export const quicksearchPluginRegistry = new PluginRegistry<
  QuicksearchPlugin,
  QuicksearchManifestEntry
>({
  kind: "quicksearch",
  getMetadata: (p) => p,
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
    needsReadOnlyDb: p.needsReadOnlyDb,
    hasSettings: !!p.settingsSchema,
  }),
});

/** Self-registration helper called at the bottom of each plugin file. */
export function registerQuicksearchPlugin(plugin: QuicksearchPlugin): void {
  quicksearchPluginRegistry.register(plugin);
}

export async function resolveQuicksearchSchema(
  plugin: QuicksearchPlugin,
): Promise<JsonSchema | undefined> {
  if (!plugin.settingsSchema) return undefined;
  return typeof plugin.settingsSchema === "function"
    ? await plugin.settingsSchema()
    : plugin.settingsSchema;
}

export async function resolveQuicksearchUiSchema(
  plugin: QuicksearchPlugin,
): Promise<QuicksearchUiSchema | undefined> {
  if (!plugin.uiSchema) return undefined;
  return typeof plugin.uiSchema === "function" ? await plugin.uiSchema() : plugin.uiSchema;
}

/**
 * Validate a config row's `data` payload against the plugin's own schema.
 * Wired to the kind's `validateConfig` so the generic CRUD routes never store
 * a searcher configuration the searcher itself cannot read.
 */
export async function validateQuicksearchSettings(
  plugin: QuicksearchPlugin,
  payload: unknown,
): Promise<{ valid: true } | { valid: false; errors: string[] }> {
  const schema = await resolveQuicksearchSchema(plugin);
  if (!schema) return { valid: true };
  const result = validateAgainstSchema(schema, payload);
  if (result.valid) return { valid: true };
  return { valid: false, errors: result.errors ?? ["Invalid settings"] };
}

import { PluginRegistry } from "../_core";
import {
  WEB_SERVICE_METHODS,
  type WebServiceManifestEntry,
  type WebServicePlugin,
} from "./types";

export const webServiceRegistry = new PluginRegistry<
  WebServicePlugin,
  WebServiceManifestEntry
>({
  kind: "web-service",
  getMetadata: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
    needsReadOnlyDb: p.needsReadOnlyDb,
    // A web service plugin is deliberately NOT a singleton: the point of the
    // kind is that one plugin can back many independently addressable
    // services.
    singleton: false,
  }),
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    order: p.order ?? 100,
    requiredComponent: p.requiredComponent,
    configSchema: p.configSchema,
    uiSchema: p.uiSchema,
    operations: p.operations.map((op) => ({
      name: op.name,
      methods: op.methods,
      description: op.description,
    })),
  }),
});

/** An operation name is a public URL segment, so keep it URL-safe and stable. */
const OPERATION_NAME_RE = /^[a-z0-9][a-z0-9_.-]*$/;

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerEventNotifier` / `registerChargePlugin`.
 *
 * The contract checks run at boot (not at request time) because a plugin that
 * declares no callable operation, or an operation whose name can't appear in a
 * URL, is a service nobody can ever reach — a silent nothing rather than a
 * loud failure.
 */
export function registerWebServicePlugin(plugin: WebServicePlugin): void {
  if (!Array.isArray(plugin.operations) || plugin.operations.length === 0) {
    throw new Error(
      `Web service plugin "${plugin.id}" declares no operations; a service with nothing to call is unreachable.`,
    );
  }
  const seen = new Set<string>();
  for (const op of plugin.operations) {
    if (!OPERATION_NAME_RE.test(op.name)) {
      throw new Error(
        `Web service plugin "${plugin.id}" declares the operation name "${op.name}", which is not a valid URL segment ` +
          `(lowercase letters, digits, "_", "." and "-", starting with a letter or digit).`,
      );
    }
    if (seen.has(op.name)) {
      throw new Error(
        `Web service plugin "${plugin.id}" declares the operation "${op.name}" twice.`,
      );
    }
    seen.add(op.name);
    if (!Array.isArray(op.methods) || op.methods.length === 0) {
      throw new Error(
        `Web service operation "${plugin.id}.${op.name}" declares no HTTP methods.`,
      );
    }
    for (const method of op.methods) {
      if (!WEB_SERVICE_METHODS.includes(method)) {
        throw new Error(
          `Web service operation "${plugin.id}.${op.name}" declares the unsupported method "${method}".`,
        );
      }
    }
    if (typeof op.handler !== "function") {
      throw new Error(
        `Web service operation "${plugin.id}.${op.name}" has no handler.`,
      );
    }
  }
  webServiceRegistry.register(plugin);
}

/** Look up a declared operation by name. Undefined when the plugin has none. */
export function findWebServiceOperation(
  plugin: WebServicePlugin,
  name: string,
) {
  return plugin.operations.find((op) => op.name === name);
}

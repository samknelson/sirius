import { PluginRegistry } from "../_core";
import {
  registerUncachedWcVendorRequest,
  type WcVendorRequestArgs,
} from "../../services/webclient/uncached";
import { registerWcRequest } from "../../services/webclient/registry";
import type {
  RegisteredWcVendorPlugin,
  WcVendorHandler,
  WcVendorOperationInfoMap,
  WcVendorOperationName,
  WcVendorPlugin,
  WcVendorManifestEntry,
  WcVendorOperationInfo,
} from "./types";

export function getWcVendorOperationManifest(
  plugin: Pick<RegisteredWcVendorPlugin, "operations">,
): WcVendorManifestEntry["operations"] {
  return Object.entries(plugin.operations).flatMap(([id, operation]) =>
    operation
      ? [{
          id,
          description: operation.description,
          needsWritableDatabase: operation.needsWritableDatabase,
          cacheMode: operation.cacheMode,
          ...(operation.manualRun ? { manualRun: operation.manualRun } : {}),
        }]
      : [],
  );
}

export const wcVendorRegistry = new PluginRegistry<
  RegisteredWcVendorPlugin,
  WcVendorManifestEntry
>({
  kind: "wc-vendors",
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
    requiredComponent: p.requiredComponent,
    addComponentId: p.addComponentId,
    credential: p.credential,
    operations: getWcVendorOperationManifest(p),
  }),
});

/**
 * The runnable handlers, kept here and handed out nowhere.
 *
 * A registered plugin is given to anything that asks for it — an admin list, a
 * config editor, a capability check — and what those callers need is what the
 * vendor CAN do, never the ability to do it. Keeping the handlers out of that
 * object is what makes "every outbound call goes through the framework" a
 * property of the code rather than a rule callers have to remember: there is
 * no second way to reach a vendor, because outside this map there is nothing
 * to reach.
 *
 * Keyed by plugin id and operation id, the same pair the framework resolves a
 * request from.
 */
const handlers = new Map<string, WcVendorHandler>();

function handlerKey(pluginId: string, operation: string): string {
  return `${pluginId}:${operation}`;
}

/**
 * The framework's own door to a vendor handler.
 *
 * Called by the web client framework and by nothing else — see the import rule
 * in `scripts/dev/check-maintenance-guards.ts`. A caller holding this could
 * make an outbound call that is not refused during maintenance, not gated on a
 * writable database and not counted, which is the whole thing the framework
 * exists to prevent.
 */
export function getWcVendorHandler(
  pluginId: string,
  operation: WcVendorOperationName,
): WcVendorHandler | undefined {
  return handlers.get(handlerKey(pluginId, operation));
}

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerChargePlugin` / `registerClientInjection`.
 *
 * Registering a plugin that names a service also registers one web client
 * request per operation it declares, so the framework learns about an
 * operation the moment the plugin declares one. The alternative — a
 * hand-written `registerUncachedWcRequest` beside each handler — is a list
 * that has to be kept in step with another list, and the failure when it is
 * not is silent: the call would throw "no behavior registered" the first time
 * somebody used the new operation.
 *
 * The handler itself is separated from the declaration here: the registry gets
 * a plugin whose operations describe themselves and cannot be run, and the
 * runnable half goes into the private map above. What used to happen instead
 * was a wrapper — the registered object carried a `run` that called the
 * framework before the real handler — which held the same guarantee only as
 * long as nothing unwrapped it. Removing the handler removes the question.
 *
 * Done at the plugin's own module top level, because the framework reads its
 * registry synchronously before any await: a registration that waited for app
 * initialization would be too late for the first request.
 *
 * Answers are never kept. A connection test that replayed yesterday's success
 * is the one thing a connection test must not say, and the rest of these
 * either change something at the vendor or return a payload — customer and
 * payment-method detail — with no business in a browsable cache table.
 */
export function registerWcVendorPlugin(plugin: WcVendorPlugin): void {
  const service = plugin.service;
  const operations: Record<
    string,
    {
      description: string;
      needsWritableDatabase: boolean;
      cacheMode: "cached" | "uncached";
      manualRun?: NonNullable<WcVendorOperationInfo["manualRun"]>;
    }
  > = {};

  for (const [requestType, declared] of Object.entries(plugin.operations)) {
    if (!declared) continue;
    const cacheMode = declared.cache?.mode ?? "uncached";
    if (cacheMode === "cached" && !service) {
      throw new Error(
        `WC vendor plugin '${plugin.id}' declares cached operation '${requestType}' ` +
          `without an outside service. Cached operations require a registered webclient service.`,
      );
    }
    if (service && declared.cache?.mode === "cached") {
      const cache = declared.cache;
      registerWcRequest<WcVendorRequestArgs>({
        service,
        requestType,
        operation: declared.description,
        cached: true,
        needsWritableDatabase: declared.needsWritableDatabase,
        freshFor: cache.freshFor,
        failureRememberedFor: cache.failureRememberedFor,
        requestKey: ({ configId, args }) =>
          `${configId}:${cache.requestKey(args as never)}`,
      });
    } else if (service) {
      registerUncachedWcVendorRequest({
        service,
        requestType,
        operation: declared.description,
        needsWritableDatabase: declared.needsWritableDatabase,
      });
    }
    handlers.set(
      handlerKey(plugin.id, requestType),
      declared.run.bind(declared) as WcVendorHandler,
    );
    operations[requestType] = {
      description: declared.description,
      needsWritableDatabase: declared.needsWritableDatabase,
      cacheMode,
      ...(declared.manualRun ? { manualRun: declared.manualRun } : {}),
    };
  }

  const { operations: _declared, ...metadata } = plugin;
  wcVendorRegistry.register({
    ...metadata,
    operations: operations as WcVendorOperationInfoMap,
  });
}

export function getWcVendorPlugin(
  id: string,
): RegisteredWcVendorPlugin | undefined {
  return wcVendorRegistry.get(id);
}

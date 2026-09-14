import { PluginRegistry } from "../_core";
import {
  registerUncachedWcVendorRequest,
  type WcVendorRequestArgs,
} from "../../services/webclient/uncached";
import { getWcRequest, registerWcRequest } from "../../services/webclient/registry";
import type {
  RegisteredWcVendorPlugin,
  WcVendorHandler,
  WcVendorOperationInfoMap,
  WcVendorOperationName,
  WcVendorPlugin,
  WcVendorManifestEntry,
  WcVendorOperationInfo,
  GatewayConnectionTest,
  NormalizedWcConnectionTest,
} from "./types";
import {
  isCanonicalWcVendorOperationName,
} from "./types";

function redactConnectionText(value: string, credential?: string): string {
  let redacted = value;
  if (credential?.trim()) {
    redacted = redacted.split(credential).join("[redacted]");
  }
  return redacted;
}

export function normalizeWcConnectionTestResult(
  value: unknown,
  credential?: string,
): NormalizedWcConnectionTest {
  if (!value || typeof value !== "object") {
    return {
      status: "unsupported",
      error: { message: "The provider returned no connection-test result." },
    };
  }
  const raw = value as GatewayConnectionTest & {
    status?: string;
    unsupported?: boolean;
    error?: unknown;
    success?: boolean;
  };
  const rawError =
    typeof raw.error === "string"
      ? { message: raw.error }
      : raw.error && typeof raw.error === "object"
        ? raw.error as Record<string, unknown>
        : undefined;
  const error = rawError
    ? {
        message: redactConnectionText(
          typeof rawError.message === "string"
            ? rawError.message
            : "The provider connection test failed.",
          credential,
        ),
        ...(typeof rawError.type === "string"
          ? { type: redactConnectionText(rawError.type, credential) }
          : {}),
        ...(typeof rawError.code === "string"
          ? { code: redactConnectionText(rawError.code, credential) }
          : {}),
      }
    : undefined;
  let status: NormalizedWcConnectionTest["status"];
  if (
    raw.status === "connected" ||
    raw.status === "misconfigured" ||
    raw.status === "unreachable" ||
    raw.status === "unsupported"
  ) {
    status = raw.status;
  } else if (raw.unsupported) {
    status = "unsupported";
  } else if (raw.connected === true) {
    status = "connected";
  } else if (raw.success === true) {
    status = "connected";
  } else if (error) {
    status = /credential|config|key|secret|token|auth/i.test(error.message)
      ? "misconfigured"
      : "unreachable";
  } else {
    status = "unsupported";
  }
  return {
    status,
    ...(raw.account &&
    typeof raw.account === "object" &&
    typeof raw.account.id === "string"
      ? {
          account: {
            id: redactConnectionText(raw.account.id, credential),
            ...(typeof raw.account.email === "string"
              ? { email: redactConnectionText(raw.account.email, credential) }
              : {}),
            ...(typeof raw.account.country === "string"
              ? { country: redactConnectionText(raw.account.country, credential) }
              : {}),
            ...(typeof raw.account.defaultCurrency === "string"
              ? { defaultCurrency: redactConnectionText(raw.account.defaultCurrency, credential) }
              : {}),
            ...(typeof raw.account.type === "string"
              ? { type: redactConnectionText(raw.account.type, credential) }
              : {}),
            ...(Array.isArray(raw.account.capabilities)
              ? {
                  capabilities: raw.account.capabilities.flatMap((capability) =>
                    capability &&
                    typeof capability === "object" &&
                    typeof capability.label === "string" &&
                    typeof capability.enabled === "boolean"
                      ? [{
                          label: redactConnectionText(capability.label, credential),
                          enabled: capability.enabled,
                        }]
                      : [],
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(raw.balances)
      ? {
          balances: raw.balances.flatMap((balance) =>
            balance &&
            typeof balance === "object" &&
            typeof balance.label === "string" &&
            typeof balance.amount === "number" &&
            typeof balance.currency === "string"
              ? [{
                  label: redactConnectionText(balance.label, credential),
                  amount: balance.amount,
                  currency: redactConnectionText(balance.currency, credential),
                }]
              : [],
          ),
        }
      : {}),
    ...(raw.testMode !== undefined ? { testMode: raw.testMode } : {}),
    ...(error ? { error } : {}),
  };
}

export function getWcVendorOperationManifest(
  plugin: Pick<RegisteredWcVendorPlugin, "operations">,
): WcVendorManifestEntry["operations"] {
  return Object.entries(plugin.operations).flatMap(([id, operation]) =>
    operation
      ? [{
          id,
          description: operation.description,
          needsWritableDatabase: operation.needsWritableDatabase,
          externalSideEffect: operation.externalSideEffect,
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
  if (wcVendorRegistry.has(plugin.id)) {
    throw new Error(`WC vendor plugin '${plugin.id}' is already registered.`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(plugin.operations, "service.test-connection") ||
    !plugin.operations["service.test-connection"]
  ) {
    throw new Error(
      `WC vendor plugin '${plugin.id}' must declare required operation 'service.test-connection'.`,
    );
  }
  const operations: Record<
    string,
    {
      description: string;
      needsWritableDatabase: boolean;
      externalSideEffect: boolean;
      cacheMode: "cached" | "uncached";
      manualRun?: NonNullable<WcVendorOperationInfo["manualRun"]>;
    }
  > = {};

  const frameworkOperations: Array<{
    requestType: string;
    description: string;
    needsWritableDatabase: boolean;
    cacheMode: "cached" | "uncached";
    freshFor: import("../../services/webclient/types").WcDuration;
    failureRememberedFor: import("../../services/webclient/types").WcDuration;
    requestKey?: (args: WcVendorRequestArgs) => string;
  }> = [];

  for (const [requestType, declared] of Object.entries(plugin.operations)) {
    if (!declared) continue;
    if (!isCanonicalWcVendorOperationName(requestType)) {
      throw new Error(
        `WC vendor plugin '${plugin.id}' declares malformed operation '${requestType}'. ` +
          "Operation ids must be canonical lowercase dotted names.",
      );
    }
    if (
      requestType === "service.test-connection" &&
      (declared.needsWritableDatabase ||
        declared.cache?.mode === "cached" ||
        declared.externalSideEffect === true)
    ) {
      throw new Error(
        `WC vendor plugin '${plugin.id}' connection test must be uncached, read-only, and side-effect free.`,
      );
    }
    if (requestType === "service.test-connection" && declared.cache?.mode === "cached") {
      throw new Error("service.test-connection must be uncached");
    }
    const cacheMode = declared.cache?.mode ?? "uncached";
    const cached =
      declared.cache?.mode === "cached" ? declared.cache : undefined;
    if (cacheMode === "cached" && !service) {
      throw new Error(
        `WC vendor plugin '${plugin.id}' declares cached operation '${requestType}' ` +
          `without an outside service. Cached operations require a registered webclient service.`,
      );
    }
    frameworkOperations.push({
      requestType,
      description: declared.description,
      needsWritableDatabase: declared.needsWritableDatabase,
      cacheMode,
      freshFor: cached?.freshFor ?? 0,
      failureRememberedFor: cached?.failureRememberedFor ?? 0,
      ...(cached
        ? {
            requestKey: ({ args }) => cached.requestKey(args as never),
          }
        : {}),
    });
    operations[requestType] = {
      description: declared.description,
      needsWritableDatabase: declared.needsWritableDatabase,
      externalSideEffect:
        declared.externalSideEffect ?? requestType !== "service.test-connection",
      cacheMode,
      ...(declared.manualRun ? { manualRun: declared.manualRun } : {}),
    };
  }

  // Preflight every framework behavior before mutating either registry. A
  // connection test is the one intentionally shared behavior, but only when
  // its observable framework metadata is identical.
  if (service) {
    for (const frameworkOperation of frameworkOperations) {
      const existing = getWcRequest(service, frameworkOperation.requestType);
      if (!existing) continue;
      const shareableConnectionTest =
        frameworkOperation.requestType === "service.test-connection" &&
        existing.operation === frameworkOperation.description &&
        existing.cached === false &&
        existing.needsWritableDatabase === frameworkOperation.needsWritableDatabase &&
        existing.freshFor === frameworkOperation.freshFor &&
        existing.failureRememberedFor === frameworkOperation.failureRememberedFor;
      if (!shareableConnectionTest) {
        throw new Error(
          `Web client request "${service}:${frameworkOperation.requestType}" is already registered with conflicting metadata.`,
        );
      }
    }
  }

  for (const frameworkOperation of frameworkOperations) {
    if (!service) continue;
    const existing = getWcRequest(service, frameworkOperation.requestType);
    if (existing && frameworkOperation.requestType === "service.test-connection") {
      continue;
    }
    if (frameworkOperation.cacheMode === "cached") {
      registerWcRequest<WcVendorRequestArgs>({
        service,
        requestType: frameworkOperation.requestType,
        operation: frameworkOperation.description,
        cached: true,
        needsWritableDatabase: frameworkOperation.needsWritableDatabase,
        freshFor: frameworkOperation.freshFor,
        failureRememberedFor: frameworkOperation.failureRememberedFor,
        requestKey: frameworkOperation.requestKey!,
      });
    } else {
      registerUncachedWcVendorRequest({
        service,
        requestType: frameworkOperation.requestType,
        operation: frameworkOperation.description,
        needsWritableDatabase: frameworkOperation.needsWritableDatabase,
      });
    }
  }

  const { operations: _declared, ...metadata } = plugin;
  wcVendorRegistry.register({
    ...metadata,
    operations: operations as WcVendorOperationInfoMap,
  });

  for (const [requestType, declared] of Object.entries(plugin.operations)) {
    if (!declared) continue;
    const handler = declared.run.bind(declared) as WcVendorHandler;
    handlers.set(
      handlerKey(plugin.id, requestType),
      requestType === "service.test-connection"
        ? (async (ctx, args) =>
            normalizeWcConnectionTestResult(
              await handler(ctx, args),
              ctx.credential?.value,
            )) as WcVendorHandler
        : handler,
    );
  }
}

export function getWcVendorPlugin(
  id: string,
): RegisteredWcVendorPlugin | undefined {
  return wcVendorRegistry.get(id);
}

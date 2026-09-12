import { PluginRegistry } from "../../_core";
import {
  registerUncachedWcRequest,
  wcUncachedRequest,
} from "../../../services/webclient/uncached";
import { isMaintenanceModeError } from "../../../services/maintenance-flag";
import { GatewayRequestError } from "./errors";
import type {
  GatewayOperation,
  GatewayOperationMap,
  GatewayOperationName,
  GatewayOperationResult,
  PaymentGatewayPlugin,
  PaymentGatewayManifestEntry,
} from "./types";
import type { WcAnswer, WcService } from "../../../services/webclient/types";

export const paymentGatewayRegistry = new PluginRegistry<
  PaymentGatewayPlugin,
  PaymentGatewayManifestEntry
>({
  kind: "payment-gateway",
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
  }),
});

/**
 * Put one declared operation on the web client framework.
 *
 * The handler is replaced rather than merely called from somewhere that knows
 * to use the framework, because "everything goes through the framework" has to
 * be true of the object, not of its callers. A registered plugin is handed out
 * by `getPaymentGatewayPlugin` to anything that asks, and a rule that only
 * holds while callers remember it is not a rule — the maintenance refusal in
 * particular is a promise about the whole process, and one forgetful caller
 * would quietly make it false. After this, reaching into `operations` and
 * calling `run` directly is still refused, still gated on a writable database
 * and still counted.
 */
function onFramework(
  service: WcService,
  requestType: string,
  declared: GatewayOperation,
): GatewayOperation {
  return {
    ...declared,
    async run(ctx, args) {
      // Whether the provider failed, tracked separately from the error itself:
      // `undefined` is a value a throw can carry, so the error cannot also be
      // the flag that says there was one.
      let providerFailed = false;
      let providerError: unknown;

      const { value, error } = await wcUncachedRequest<unknown>({
        service,
        requestType,
        fetch: async (): Promise<WcAnswer<unknown>> => {
          try {
            return { answered: true, value: await declared.run(ctx, args) };
          } catch (thrown) {
            // A refusal is the framework's own answer, not the vendor's.
            if (isMaintenanceModeError(thrown)) throw thrown;
            providerFailed = true;
            providerError = thrown;
            return {
              answered: false,
              error: thrown instanceof Error ? thrown.message : String(thrown),
            };
          }
        },
      });

      // The provider's own error object, unchanged. A route that reads
      // `error.code === "resource_missing"` to turn a vendor's "no such thing"
      // into a 404 is reading that object; replacing it with the framework's
      // one-line summary would silently turn every one of those into a 500.
      if (providerFailed) throw providerError;
      if (error !== undefined) {
        // The provider was never asked, because the answer could not be
        // recorded. The framework's own words, unedited.
        throw new GatewayRequestError(503, error);
      }
      return value as GatewayOperationResult<GatewayOperationName>;
    },
  };
}

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerChargePlugin` / `registerClientInjection`.
 *
 * Registering a plugin that names a service also registers one web client
 * request per operation it declares, and registers the plugin with each
 * handler already wrapped in that request. The framework therefore learns
 * about an operation the moment the plugin declares one. The alternative — a
 * hand-written `registerUncachedWcRequest` beside each handler — is a list
 * that has to be kept in step with another list, and the failure when it is
 * not is silent: the call would throw "no behavior registered" the first time
 * somebody used the new operation.
 *
 * Done here, at the plugin's own module top level, because the framework reads
 * its registry synchronously before any await: a registration that waited for
 * app initialization would be too late for the first request.
 *
 * Answers are never kept. A connection test that replayed yesterday's success
 * is the one thing a connection test must not say, and the rest of these
 * either change something at the vendor or return a payload — customer and
 * payment-method detail — with no business in a browsable cache table.
 */
export function registerPaymentGatewayPlugin(plugin: PaymentGatewayPlugin): void {
  const service = plugin.service;
  if (!service) {
    // No outside system; see PaymentGatewayPlugin.service.
    paymentGatewayRegistry.register(plugin);
    return;
  }

  const operations: Record<string, GatewayOperation> = {};
  for (const [requestType, declared] of Object.entries(plugin.operations)) {
    if (!declared) continue;
    registerUncachedWcRequest({
      service,
      requestType,
      operation: declared.operation,
      needsWritableDatabase: declared.needsWritableDatabase,
    });
    operations[requestType] = onFramework(service, requestType, declared);
  }

  paymentGatewayRegistry.register({
    ...plugin,
    operations: operations as GatewayOperationMap,
  });
}

export function getPaymentGatewayPlugin(
  id: string,
): PaymentGatewayPlugin | undefined {
  return paymentGatewayRegistry.get(id);
}

import { storage } from "../../storage";
import { getWcVendorPlugin } from "../../plugins/wc-vendors";
import type {
  WcVendorOperation,
  WcVendorOperationArgs,
  WcVendorOperationName,
  WcVendorOperationResult,
  WcVendorContext,
  WcVendorPlugin,
} from "../../plugins/wc-vendors/types";
import type { PluginConfig } from "@shared/schema";
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../config/env-registry";
import {
  WcVendorError,
  WcVendorRequestError,
} from "../../plugins/wc-vendors/errors";

/**
 * A gateway config resolved into everything the generic payment-methods routes
 * need to talk to the provider: the config row, the registered plugin, and a
 * ready-to-use provider context carrying the per-config API key.
 */
export interface ResolvedWcVendor {
  config: PluginConfig;
  plugin: WcVendorPlugin;
  context: WcVendorContext;
}

/** The config, plugin or credential could not be resolved. */
export class WcVendorResolutionError extends WcVendorError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "WcVendorResolutionError";
  }
}

// Raised inside the kind, caught out here: a route wants one name for "the
// provider was not reached", whatever the reason.
export { WcVendorError, WcVendorRequestError };

/**
 * Turn a gateway config id into a {@link ResolvedWcVendor}. Resolves the
 * provider API key from the secret the config names (`data.secretName`, read
 * via the env registry), so multiple configs (e.g. two Stripe accounts)
 * each use their own credentials.
 */
export async function resolveWcVendor(
  gatewayConfigId: string,
): Promise<ResolvedWcVendor> {
  const config = await storage.pluginConfigs.get(gatewayConfigId);
  if (!config || config.pluginKind !== "wc-vendors") {
    throw new WcVendorResolutionError(404, "Vendor configuration not found");
  }
  if (!config.enabled) {
    throw new WcVendorResolutionError(409, "Vendor configuration is disabled");
  }

  const plugin = getWcVendorPlugin(config.pluginId);
  if (!plugin) {
    throw new WcVendorResolutionError(
      404,
      `No vendor plugin registered for '${config.pluginId}'`,
    );
  }

  const data = (config.data ?? {}) as Record<string, unknown>;
  const secretName = typeof data.secretName === "string" ? data.secretName : "";
  if (!secretName) {
    throw new WcVendorResolutionError(
      503,
      "Vendor configuration does not name a credential secret",
    );
  }

  // Dynamically-named credential: register in the env registry at resolve
  // time (as a secret) so the environment contract stays complete.
  // changeTakesEffect: "immediate" — the vendor is resolved afresh per
  // request and the credential is read here each time, never cached.
  //
  // The category is "webclient", not the domain of whatever the vendor
  // happens to do. Registration here is last-write-wins, so declaring a
  // domain would let the first vendor resolved stamp its own domain on every
  // other vendor's credential; and since the kind stopped being ledger-owned,
  // a vendor that has nothing to do with payments must not have its secret
  // filed under the ledger.
  registerEnvironmentVariable({
    name: secretName,
    description: `Vendor credential secret named by config '${config.siriusId ?? config.id}'.`,
    secret: true,
    category: "webclient",
    changeTakesEffect: "immediate",
  });
  const apiKey = getEnvironmentVariable(secretName);
  if (!apiKey && plugin.requiresSecret !== false) {
    throw new WcVendorResolutionError(
      503,
      `Vendor credential secret '${secretName}' is not set`,
    );
  }

  return { config, plugin, context: { apiKey: apiKey ?? "", config } };
}

/**
 * Ask a resolved gateway to do one thing.
 *
 * The typed door callers use: it names the operation rather than a method, so
 * a caller says what it wants done without knowing which vendor is behind the
 * config, and asking for something the vendor cannot do is answered rather
 * than crashing on a missing function.
 *
 * The web client framework is NOT applied here. A registered plugin's handlers
 * are already wrapped in it (see `registerWcVendorPlugin`), so the
 * maintenance refusal, the writable-database gate and the usage count hold for
 * every route into the handler, not just this one. What this owns is the
 * resolved credential — which the handler reads and nothing else sees — and
 * the refusal below.
 */
export async function wcVendorRequest<N extends WcVendorOperationName>(
  resolved: ResolvedWcVendor,
  name: N,
  args: WcVendorOperationArgs<N>,
): Promise<WcVendorOperationResult<N>> {
  const operation: WcVendorOperation<N> | undefined = resolved.plugin.operations[name];
  if (!operation) {
    throw new WcVendorRequestError(
      501,
      `Vendor '${resolved.plugin.name}' does not support '${name}'`,
    );
  }
  return operation.run(resolved.context, args);
}

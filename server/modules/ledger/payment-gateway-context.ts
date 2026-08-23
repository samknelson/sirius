import { storage } from "../../storage";
import { getPaymentGatewayPlugin } from "../../plugins/ledger/payment-gateway";
import type {
  PaymentGatewayContext,
  PaymentGatewayPlugin,
} from "../../plugins/ledger/payment-gateway/types";
import type { PluginConfig } from "@shared/schema";
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../config/env-registry";

/**
 * A gateway config resolved into everything the generic payment-methods routes
 * need to talk to the provider: the config row, the registered plugin, and a
 * ready-to-use provider context carrying the per-config API key.
 */
export interface ResolvedGateway {
  config: PluginConfig;
  plugin: PaymentGatewayPlugin;
  context: PaymentGatewayContext;
}

/** Error carrying the HTTP status the route should return. */
export class GatewayResolutionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GatewayResolutionError";
  }
}

/**
 * Turn a gateway config id into a {@link ResolvedGateway}. Resolves the
 * provider API key from the secret the config names (`data.secretName`, read
 * via the env registry), so multiple configs (e.g. two Stripe accounts)
 * each use their own credentials.
 */
export async function resolveGateway(
  gatewayConfigId: string,
): Promise<ResolvedGateway> {
  const config = await storage.pluginConfigs.get(gatewayConfigId);
  if (!config || config.pluginKind !== "payment-gateway") {
    throw new GatewayResolutionError(404, "Payment gateway configuration not found");
  }
  if (!config.enabled) {
    throw new GatewayResolutionError(409, "Payment gateway configuration is disabled");
  }

  const plugin = getPaymentGatewayPlugin(config.pluginId);
  if (!plugin) {
    throw new GatewayResolutionError(
      404,
      `No payment gateway plugin registered for '${config.pluginId}'`,
    );
  }

  const data = (config.data ?? {}) as Record<string, unknown>;
  const secretName = typeof data.secretName === "string" ? data.secretName : "";
  if (!secretName) {
    throw new GatewayResolutionError(
      503,
      "Payment gateway configuration does not name a credential secret",
    );
  }

  // Dynamically-named credential: register in the env registry at resolve
  // time (as a secret) so the environment contract stays complete.
  // changeTakesEffect: "immediate" — the gateway is resolved afresh per
  // request and the credential is read here each time, never cached.
  registerEnvironmentVariable({
    name: secretName,
    description: `Payment-gateway credential secret named by config '${config.siriusId ?? config.id}'.`,
    secret: true,
    category: "ledger",
    changeTakesEffect: "immediate",
  });
  const apiKey = getEnvironmentVariable(secretName);
  if (!apiKey && plugin.requiresSecret !== false) {
    throw new GatewayResolutionError(
      503,
      `Payment gateway credential secret '${secretName}' is not set`,
    );
  }

  return { config, plugin, context: { apiKey: apiKey ?? "", config } };
}

import { storage } from "../../storage";
import { getComponentChecker } from "../../services/access-policy-evaluator";
import { getWcVendorPlugin } from "../../plugins/wc-vendors";
import {
  PAYMENT_GATEWAY_OPERATIONS,
  isPaymentGatewayPlugin,
} from "./payment-gateway-definition";

export {
  PAYMENT_GATEWAY_OPERATIONS,
  isPaymentGatewayPlugin,
} from "./payment-gateway-definition";

/**
 * Which webclient vendors the ledger is allowed to treat as a payment gateway.
 *
 * The `wc-vendors` kind is component-neutral: a vendor is any outside system
 * this site calls, and every operation a plugin can declare is optional. The
 * ledger needs much more than "is a vendor" — it needs a vendor that can carry
 * a customer and a stored payment method through their whole life. So the
 * capability is defined here, by the ledger, as the set of operations its own
 * payment-method routes call.
 *
 * A non-empty `supportedPaymentTypes` catalog is deliberately NOT the test.
 * That catalog only drives the accepted-payment-types editor; a vendor could
 * publish one and still be unable to create a customer, which is the failure
 * this guard exists to prevent.
 */
/** A vendor config offered to a ledger payment surface. */
export interface PaymentGatewayOption {
  id: string;
  pluginId: string;
  /** Nullable because a plugin config's name is; matches `/api/wc-vendors`. */
  name: string | null;
  /**
   * The plugin publishes a payment-type catalog, so the accepted-payment-types
   * editor has something to offer. Payment-capable vendors without one are
   * still usable everywhere else.
   */
  acceptsPaymentTypes: boolean;
}

/**
 * The vendor configs the ledger may offer: enabled, plugin registered, plugin
 * component enabled, and payment-gateway capable.
 *
 * One builder for every ledger surface (the account gateway picker, the
 * payment-method picker and the accepted-payment-types editor) so they cannot
 * drift into offering different sets.
 */
export async function listPaymentGatewayConfigs(): Promise<PaymentGatewayOption[]> {
  const configs = await storage.pluginConfigs.getByKind("wc-vendors");
  const checker = getComponentChecker();
  const available: PaymentGatewayOption[] = [];

  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    const plugin = getWcVendorPlugin(cfg.pluginId);
    if (!plugin) continue;
    if (
      plugin.requiredComponent &&
      (!checker || !(await checker(plugin.requiredComponent)))
    ) {
      continue;
    }
    if (!isPaymentGatewayPlugin(plugin)) continue;
    available.push({
      id: cfg.id,
      pluginId: cfg.pluginId,
      name: cfg.name,
      acceptsPaymentTypes: (plugin.supportedPaymentTypes ?? []).length > 0,
    });
  }

  return available;
}

/** Why a config may not be used as a ledger payment gateway, or null if it may. */
export async function checkPaymentGatewayConfig(
  configId: string,
): Promise<{ status: number; message: string } | null> {
  const config = await storage.pluginConfigs.get(configId);
  if (!config || config.pluginKind !== "wc-vendors") {
    return { status: 400, message: "Vendor configuration not found" };
  }

  const plugin = getWcVendorPlugin(config.pluginId);
  if (!plugin) {
    return {
      status: 400,
      message: `No vendor plugin registered for '${config.pluginId}'`,
    };
  }

  if (plugin.requiredComponent) {
    const checker = getComponentChecker();
    if (!checker || !(await checker(plugin.requiredComponent))) {
      return {
        status: 400,
        message: `Component not enabled: ${plugin.requiredComponent}`,
      };
    }
  }

  if (!isPaymentGatewayPlugin(plugin)) {
    const missing = PAYMENT_GATEWAY_OPERATIONS.filter(
      (name) => plugin.operations[name] === undefined,
    );
    return {
      status: 400,
      message: `Vendor '${plugin.name}' cannot be used as a payment gateway (missing: ${missing.join(", ")}).`,
    };
  }

  return null;
}

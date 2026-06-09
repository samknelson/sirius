import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import {
  requireAccess,
  getComponentChecker,
} from "../../services/access-policy-evaluator";
import { getPaymentGatewayPlugin } from "../../plugins/ledger/payment-gateway";
import {
  resolveGateway,
  GatewayResolutionError,
} from "./payment-gateway-context";

/**
 * Provider-generic payment-gateway admin routes.
 *
 * Exposes a connection test keyed by a gateway CONFIG id, so any provider — and
 * any number of configs (e.g. two Stripe accounts) — can be tested
 * independently using that config's own credentials. All provider knowledge
 * lives behind the payment-gateway plugin; this module stays provider-agnostic.
 *
 * Access is admin-gated, plus the resolved plugin's `requiredComponent` is
 * enforced on top. Nothing here hardcodes `stripe` or `ledger.stripe`.
 */
export function registerLedgerPaymentGatewayRoutes(app: Express): void {
  const base = "/api/ledger/payment-gateways";

  // List the gateway configs available to test: enabled configs whose plugin is
  // registered and whose required component (if any) is enabled.
  app.get(base, requireAccess("admin"), async (_req: Request, res: Response) => {
    try {
      const configs = await storage.pluginConfigs.getByType("payment-gateway");
      const checker = getComponentChecker();
      const available = [];
      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        const plugin = getPaymentGatewayPlugin(cfg.pluginId);
        if (!plugin) continue;
        if (
          plugin.requiredComponent &&
          (!checker || !(await checker(plugin.requiredComponent)))
        ) {
          continue;
        }
        available.push({ id: cfg.id, pluginId: cfg.pluginId, name: cfg.name });
      }
      res.json(available);
    } catch (error: any) {
      res.status(500).json({
        message: "Failed to fetch payment gateways",
        error: error?.message ?? String(error),
      });
    }
  });

  // Run a connection test against a specific gateway config.
  app.get(
    `${base}/:configId/test`,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const resolved = await resolveGateway(req.params.configId);

        const component = resolved.plugin.requiredComponent;
        if (component) {
          const checker = getComponentChecker();
          if (!checker || !(await checker(component))) {
            return res
              .status(403)
              .json({ message: `Component not enabled: ${component}` });
          }
        }

        const result = await resolved.plugin.testConnection(resolved.context);
        res.json(result);
      } catch (error: any) {
        if (error instanceof GatewayResolutionError) {
          return res
            .status(error.status)
            .json({ connected: false, error: { message: error.message } });
        }
        res.status(500).json({
          connected: false,
          error: {
            message: error?.message ?? "Failed to run connection test",
          },
        });
      }
    },
  );
}

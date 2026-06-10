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
      const configs = await storage.pluginConfigs.getByKind("payment-gateway");
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

  // Resolve a gateway config + its registered plugin WITHOUT requiring the
  // credential secret. Editing accepted payment types must work even before a
  // secret is configured, so we deliberately avoid `resolveGateway` (which
  // resolves the API key). Also enforces the plugin's required component.
  async function resolveConfigForEditing(configId: string): Promise<
    | { ok: true; config: Awaited<ReturnType<typeof storage.pluginConfigs.get>>; plugin: NonNullable<ReturnType<typeof getPaymentGatewayPlugin>> }
    | { ok: false; status: number; message: string }
  > {
    const config = await storage.pluginConfigs.get(configId);
    if (!config || config.pluginKind !== "payment-gateway") {
      return { ok: false, status: 404, message: "Payment gateway configuration not found" };
    }
    const plugin = getPaymentGatewayPlugin(config.pluginId);
    if (!plugin) {
      return {
        ok: false,
        status: 404,
        message: `No payment gateway plugin registered for '${config.pluginId}'`,
      };
    }
    if (plugin.requiredComponent) {
      const checker = getComponentChecker();
      if (!checker || !(await checker(plugin.requiredComponent))) {
        return {
          ok: false,
          status: 403,
          message: `Component not enabled: ${plugin.requiredComponent}`,
        };
      }
    }
    return { ok: true, config, plugin };
  }

  // Read a config's accepted payment types plus the provider's catalog of
  // selectable types, so the editor stays provider-agnostic.
  app.get(
    `${base}/:configId/payment-types`,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const resolved = await resolveConfigForEditing(req.params.configId);
        if (!resolved.ok) {
          return res.status(resolved.status).json({ message: resolved.message });
        }
        const data = (resolved.config!.data ?? {}) as Record<string, unknown>;
        const selected = Array.isArray(data.paymentTypes)
          ? (data.paymentTypes as unknown[]).filter((v): v is string => typeof v === "string")
          : [];
        res.json({
          available: resolved.plugin.supportedPaymentTypes ?? [],
          selected,
        });
      } catch (error: any) {
        res.status(500).json({
          message: "Failed to fetch payment types",
          error: error?.message ?? String(error),
        });
      }
    },
  );

  // Save a config's accepted payment types onto its own `data.paymentTypes`.
  app.put(
    `${base}/:configId/payment-types`,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const resolved = await resolveConfigForEditing(req.params.configId);
        if (!resolved.ok) {
          return res.status(resolved.status).json({ message: resolved.message });
        }

        const { paymentTypes } = req.body ?? {};
        if (!Array.isArray(paymentTypes) || paymentTypes.some((t) => typeof t !== "string")) {
          return res.status(400).json({ message: "paymentTypes must be an array of strings" });
        }
        if (paymentTypes.length === 0) {
          return res.status(400).json({ message: "Select at least one payment type" });
        }

        // Validate every requested type against the provider's catalog (when it
        // declares one), so a config can't accept a type the provider rejects.
        const catalog = resolved.plugin.supportedPaymentTypes;
        if (catalog && catalog.length > 0) {
          const validIds = new Set(catalog.map((o) => o.id));
          const invalid = paymentTypes.filter((t: string) => !validIds.has(t));
          if (invalid.length > 0) {
            return res.status(400).json({
              message: `Invalid payment types: ${invalid.join(", ")}`,
              validTypes: catalog.map((o) => o.id),
            });
          }
        }

        const existingData = (resolved.config!.data ?? {}) as Record<string, unknown>;
        await storage.pluginConfigs.update(resolved.config!.id, {
          data: { ...existingData, paymentTypes },
        });

        res.json({ paymentTypes });
      } catch (error: any) {
        res.status(500).json({
          message: "Failed to update payment types",
          error: error?.message ?? String(error),
        });
      }
    },
  );

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

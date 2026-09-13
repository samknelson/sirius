import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import {
  requireAccess,
  getComponentChecker,
} from "../../services/access-policy-evaluator";
import {
  getWcVendorPlugin,
  getWcVendorOperationManifest,
} from "../../plugins/wc-vendors";
import { wcRequest } from "../../services/webclient";
import {
  describeWcVendor,
  WcVendorError,
} from "../../services/webclient/wc-vendor-context";
import { isMaintenanceModeError } from "../../services/maintenance-flag";

/**
 * Component-neutral wc-vendors admin routes.
 *
 * A webclient vendor is any outside system this site calls through the web
 * client framework, so listing and testing one is not a ledger concern and
 * these routes carry no domain component gate. What IS enforced is the
 * resolved plugin's own `requiredComponent` — Stripe's routes stay dark
 * unless `ledger.stripe` is on, without the vendor framework itself knowing
 * what a ledger is.
 *
 * The one genuinely payment-shaped field, a config's accepted payment types,
 * stays behind `/api/ledger/wc-vendors` in the ledger module.
 *
 * Access is admin-gated. Nothing here hardcodes `stripe` or `ledger.stripe`.
 */
export function registerWcVendorRoutes(app: Express): void {
  const base = "/api/wc-vendors";

  // List the usable vendor configs: enabled configs whose plugin is registered
  // and whose required component (if any) is enabled.
  //
  // Each entry also says what the vendor can DO, because every operation on
  // `WcVendorOperations` is optional and `supportedPaymentTypes` is a Stripe-
  // shaped extra, not a promise the kind makes. While the kind was ledger-
  // gated every vendor happened to be a testable payment gateway and callers
  // could assume it; now that any outside system can be a vendor, a caller
  // that offers a config it cannot actually use would fail at the point of
  // use (a 501 from the framework, or an empty payment-type editor). So
  // the capabilities are reported here once and each surface filters on the
  // one it needs, rather than every surface re-deriving them.
  app.get(base, requireAccess("admin"), async (_req: Request, res: Response) => {
    try {
      const configs = await storage.pluginConfigs.getByKind("wc-vendors");
      const checker = getComponentChecker();
      const available = [];
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
        const operations = getWcVendorOperationManifest(plugin);
        available.push({
          id: cfg.id,
          pluginId: cfg.pluginId,
          name: cfg.name,
          operations,
          canTest: operations.some((operation) => operation.id === "test-connection"),
          acceptsPaymentTypes: (plugin.supportedPaymentTypes ?? []).length > 0,
        });
      }
      res.json(available);
    } catch (error: any) {
      res.status(500).json({
        message: "Failed to fetch vendors",
        error: error?.message ?? String(error),
      });
    }
  });

  // Run a connection test against a specific vendor config.
  app.get(
    `${base}/:configId/test`,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const vendor = await describeWcVendor({ configId: req.params.configId });

        const component = vendor.requiredComponent;
        if (component) {
          const checker = getComponentChecker();
          if (!checker || !(await checker(component))) {
            return res
              .status(403)
              .json({ message: `Component not enabled: ${component}` });
          }
        }

        const result = await wcRequest({
          vendor: { configId: vendor.configId },
          operation: "test-connection",
          args: undefined,
        });
        if (result.outcome === "success") return res.json(result.value);
        // A test that did not run is not a test that failed, but this page has
        // one place to show either. The provider's own error object goes to the
        // catch below, which knows how to read a provider status; anything else
        // is the framework's own sentence about why nothing was asked.
        if (result.cause !== undefined) throw result.cause;
        res.status(503).json({
          connected: false,
          error: { message: result.error ?? "The connection test did not run." },
        });
      } catch (error: any) {
        // A refusal is reported in this route's own shape, so the page shows
        // why the test did not run where it shows every other failure.
        if (isMaintenanceModeError(error)) {
          return res
            .status(error.statusCode)
            .json({ connected: false, error: { message: error.message } });
        }
        if (error instanceof WcVendorError) {
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

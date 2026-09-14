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
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";
import type { WcVendorOperationName } from "../../plugins/wc-vendors/types";
import type { JsonSchema } from "@shared/json-schema-form";
import {
  describeWcVendor,
  WcVendorError,
} from "../../services/webclient/wc-vendor-context";
import { isMaintenanceModeError } from "../../services/maintenance-flag";

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  // AJV is configured with useDefaults to match RJSF. Validate a detached
  // value so defaults are not written into Express's request body (which may
  // be observed by later middleware or logging).
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

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

  /**
   * The consolidated read used by the WC administration page. The config and
   * component checks intentionally mirror the generic vendor list above:
   * disabled, unregistered, and component-gated connections are not leaked,
   * while every operation of a usable connection gets a row even when it has
   * never been called.
   */
  app.get("/api/admin/wc-overview", requireAccess("admin"), async (_req, res) => {
    try {
      const configs = await storage.pluginConfigs.getByKind("wc-vendors");
      const checker = getComponentChecker();
      const available: Array<{
        config: typeof configs[number];
        plugin: NonNullable<ReturnType<typeof getWcVendorPlugin>>;
      }> = [];
      for (const config of configs) {
        if (!config.enabled) continue;
        const plugin = getWcVendorPlugin(config.pluginId);
        if (!plugin) continue;
        if (
          plugin.requiredComponent &&
          (!checker || !(await checker(plugin.requiredComponent)))
        ) continue;
        available.push({ config, plugin });
      }

      const today = getTodayYmd();
      const start = addDaysYmd(today, -6);
      const counts = await storage.wcStats.countsByConfiguration({
        start,
        end: today,
        configurationIds: available.map(({ config }) => config.id),
      });
      const byKey = new Map(
        counts.map((row) => [
          `${row.configurationId}:${row.service}:${row.requestType}`,
          row.calls,
        ]),
      );
      const todayByKey = new Map(
        counts.map((row) => [
          `${row.configurationId}:${row.service}:${row.requestType}`,
          row.todayCalls,
        ]),
      );

      const rows = available.flatMap(({ config, plugin }) =>
        getWcVendorOperationManifest(plugin).map((operation) => {
          const service = plugin.service ?? null;
          const key = `${config.id}:${service ?? ""}:${operation.id}`;
          const callsLast7Days = byKey.get(key) ?? 0;
          return {
            pluginId: plugin.id,
            pluginName: plugin.name,
            vendor: plugin.name,
            service,
            requestType: operation.id,
            configurationId: config.id,
            configurationName: config.name ?? null,
            cached: operation.cacheMode === "cached",
            needsWritableDatabase: operation.needsWritableDatabase,
            externalSideEffect: operation.externalSideEffect,
            callsToday: todayByKey.get(key) ?? 0,
            callsLast7Days,
            manualRun: operation.manualRun,
          };
        }),
      );

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({
        message: "Failed to fetch web client overview",
        error: error?.message ?? String(error),
      });
    }
  });

  /**
   * Run one explicitly selected operation. No handler or resolved credential
   * crosses this boundary: all addressing and capability checks happen again
   * immediately before the single framework call.
   */
  app.post(
    "/api/admin/wc-overview/:configId/:operation/run",
    requireAccess("admin"),
    async (req, res) => {
      try {
        const config = await storage.pluginConfigs.get(req.params.configId);
        if (!config || config.pluginKind !== "wc-vendors") {
          return res.status(404).json({ message: "Vendor configuration not found" });
        }
        if (!config.enabled) {
          return res.status(409).json({ message: "Vendor configuration is disabled" });
        }
        const plugin = getWcVendorPlugin(config.pluginId);
        if (!plugin) {
          return res.status(404).json({ message: "Vendor plugin is not registered" });
        }
        const checker = getComponentChecker();
        if (
          plugin.requiredComponent &&
          (!checker || !(await checker(plugin.requiredComponent)))
        ) {
          return res
            .status(403)
            .json({ message: `Component not enabled: ${plugin.requiredComponent}` });
        }

        const operation = plugin.operations[
          req.params.operation as WcVendorOperationName
        ];
        if (!operation || !operation.manualRun) {
          return res.status(409).json({
            message: "This operation is not available for manual execution",
          });
        }
        const forceFresh = req.body?.forceFresh === true;
        if (forceFresh && operation.cacheMode !== "cached") {
          return res.status(400).json({
            message: "A fresh provider call can only be requested for cached operations",
          });
        }
        const args = req.body?.args;
        const validatedArgs = cloneJsonValue(args);
        const validation = validateAgainstSchema(
          cloneJsonValue(operation.manualRun.argsSchema) as JsonSchema,
          validatedArgs,
        );
        if (!validation.valid) {
          return res.status(400).json({
            message: "Invalid operation arguments",
            errors: validation.errors,
          });
        }
        if (operation.manualRun.effect === "write" && req.body?.confirmedWrite !== true) {
          return res.status(400).json({
            message: "Explicit confirmation is required for write operations",
          });
        }

        const result = await wcRequest({
          vendor: { configId: config.id },
          operation: req.params.operation as WcVendorOperationName,
          args: validatedArgs as never,
          ...(forceFresh ? { mode: "force" as const } : {}),
        });
        return res.json(result);
      } catch (error: any) {
        if (error instanceof WcVendorError) {
          return res.status(error.status).json({ message: error.message });
        }
        if (isMaintenanceModeError(error)) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({
          message: error?.message ?? "Failed to run web client operation",
        });
      }
    },
  );

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
           canTest: operations.some((operation) => operation.id === "service.test-connection"),
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
           operation: "service.test-connection",
          args: undefined,
        });
        if (result.outcome === "success") return res.json(result.value);
        // A test that did not run is not a test that failed, but this page has
        // one place to show either. The provider's own error object goes to the
        // catch below, which knows how to read a provider status; anything else
        // is the framework's own sentence about why nothing was asked.
        if (result.cause !== undefined) throw result.cause;
        res.status(503).json({
          status: "unreachable",
          error: { message: result.error ?? "The connection test did not run." },
        });
      } catch (error: any) {
        // A refusal is reported in this route's own shape, so the page shows
        // why the test did not run where it shows every other failure.
        if (isMaintenanceModeError(error)) {
          return res
            .status(error.statusCode)
              .json({ status: "unreachable", error: { message: error.message } });
        }
        if (error instanceof WcVendorError) {
          return res
            .status(error.status)
            .json({ status: "misconfigured", error: { message: error.message } });
        }
        res.status(500).json({
          status: "unreachable",
          error: {
            message: error?.message ?? "Failed to run connection test",
          },
        });
      }
    },
  );
}

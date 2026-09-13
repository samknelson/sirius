import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import {
  requireAccess,
  getComponentChecker,
} from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getWcVendorPlugin } from "../../plugins/wc-vendors";
import { listPaymentGatewayConfigs } from "./payment-gateway-capability";

/**
 * The one ledger-owned corner of the wc-vendors kind: which payment types a
 * vendor config accepts.
 *
 * Listing and testing vendors moved to `/api/wc-vendors` when the kind stopped
 * being ledger-gated — a webclient vendor is any outside system this site
 * calls, not a payments concept. Accepted payment types genuinely are a
 * payments concept, so they stay here, under `/api/ledger/`, behind the
 * `ledger` component.
 *
 * That component check is load-bearing: it used to come for free from the
 * kind's own `requiredComponent: "ledger"`, and ungating the kind would
 * otherwise have left these two routes reachable on a site with no ledger at
 * all. On top of it, the resolved plugin's own `requiredComponent` is
 * enforced. Nothing here hardcodes `stripe` or `ledger.stripe`.
 */
export function registerLedgerWcVendorRoutes(app: Express): void {
  const base = "/api/ledger/wc-vendors";
  const ledgerComponent = requireComponent("ledger");

  // The vendors the ledger may use as payment gateways.
  //
  // This is NOT the neutral `/api/wc-vendors` list with a different gate: it is
  // a strictly smaller set, because a component-neutral vendor need not be able
  // to do anything payment-shaped at all. Ledger surfaces pick from here so
  // they cannot offer a vendor whose first real use would fail.
  app.get(
    base,
    requireAccess("admin"),
    ledgerComponent,
    async (_req: Request, res: Response) => {
      try {
        res.json(await listPaymentGatewayConfigs());
      } catch (error: any) {
        res.status(500).json({
          message: "Failed to fetch payment gateways",
          error: error?.message ?? String(error),
        });
      }
    },
  );

  // Resolve a vendor config + its registered plugin WITHOUT requiring the
  // credential secret. Editing accepted payment types must work even before a
  // secret is configured, so we deliberately avoid `resolveWcVendor` (which
  // resolves the API key). Also enforces the plugin's required component.
  async function resolveConfigForEditing(configId: string): Promise<
    | { ok: true; config: Awaited<ReturnType<typeof storage.pluginConfigs.get>>; plugin: NonNullable<ReturnType<typeof getWcVendorPlugin>> }
    | { ok: false; status: number; message: string }
  > {
    const config = await storage.pluginConfigs.get(configId);
    if (!config || config.pluginKind !== "wc-vendors") {
      return { ok: false, status: 404, message: "Vendor configuration not found" };
    }
    const plugin = getWcVendorPlugin(config.pluginId);
    if (!plugin) {
      return {
        ok: false,
        status: 404,
        message: `No vendor plugin registered for '${config.pluginId}'`,
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
    ledgerComponent,
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
    ledgerComponent,
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
          // Reject types the provider marks as NOT saveable via the
          // add-a-payment-method (SetupIntent) flow. Selecting them would
          // guarantee a failure when an entity later tries to add a method, so
          // block the bad state at save time and name the offenders. Providers
          // that don't declare `setupEligible` are unaffected (treated as
          // eligible).
          const notSavable = catalog
            .filter((o) => o.setupEligible === false)
            .map((o) => o.id);
          const notSavableSet = new Set(notSavable);
          const rejected = paymentTypes.filter((t: string) => notSavableSet.has(t));
          if (rejected.length > 0) {
            return res.status(400).json({
              message: `These payment types can't be saved as a reusable payment method: ${rejected.join(", ")}. Choose a card or bank account type instead.`,
              notSavableTypes: notSavable,
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
}

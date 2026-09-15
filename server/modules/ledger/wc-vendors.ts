import type { Express, Request, Response } from "express";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { listPaymentGatewayConfigs } from "./payment-gateway-capability";

/**
 * Ledger-owned list of configured webclient vendors that satisfy the complete
 * payment-gateway operation contract. Accepted payment types are edited through
 * the normal generic plugin-config route.
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

}

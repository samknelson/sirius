/**
 * Admin routes for staging Freeman's legacy EDLS data.
 *
 * Connection configuration and testing live on the shared webclient-vendors
 * surface. These routes retain only the migration-specific source report,
 * sweeps, and staged-row management. They are authenticated, admin-only, and
 * gated on both EDLS and this site-specific component.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import { storage } from "../../../../storage";
import { sendIfMaintenanceRefusal } from "../../../../services/maintenance-flag";
import { FREEMAN_EDLS_MIGRATE_COMPONENT_ID } from "../../../../plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate";
import {
  FREEMAN_EDLS_FIELD_TABLES,
  FREEMAN_EDLS_NODE_TABLE,
  FREEMAN_EDLS_SHEET_NODE_TYPE,
  runFreemanEdlsFieldSweep,
  runFreemanEdlsNodeSweep,
} from "./sweep";

/**
 * An unexpected error's text is written by code we do not control end to end,
 * so it goes through the same redaction as a result before it is sent.
 */
function failureMessage(error: unknown, fallback: string): string {
  // Provider refusals that are safe for display are returned inside the sweep
  // report. An exception reaching the route is unexpected and must not echo a
  // vendor/transport message: this boundary no longer has credential access
  // and therefore cannot prove that arbitrary exception text is scrubbed.
  void error;
  return fallback;
}

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerFreemanEdlsMigrateRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  const edlsComponent = requireComponent("edls");
  const migrateComponent = requireComponent(FREEMAN_EDLS_MIGRATE_COMPONENT_ID);
  const gate = [requireAuth, requirePermission("admin"), edlsComponent, migrateComponent];

  /**
   * What the sweeps will read, so the page can say what is about to happen
   * before anything is fetched.
   */
  app.get(
    "/api/sitespecific/freeman/edls-migrate/sources",
    ...gate,
    async (_req: Request, res: Response) => {
      res.json({
        nodeTable: FREEMAN_EDLS_NODE_TABLE,
        sheetNodeType: FREEMAN_EDLS_SHEET_NODE_TYPE,
        fieldTables: FREEMAN_EDLS_FIELD_TABLES,
      });
    },
  );

  // Like the ping, a sweep that could not finish is still a report: the reason
  // is in the body and the page shows it, so these answer 200.
  app.post(
    "/api/sitespecific/freeman/edls-migrate/sweep/nodes",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await runFreemanEdlsNodeSweep());
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          message: failureMessage(error, "Failed to sweep the legacy node table"),
        });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/sweep/fields",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await runFreemanEdlsFieldSweep());
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          message: failureMessage(error, "Failed to sweep the legacy field tables"),
        });
      }
    },
  );

  app.get(
    "/api/sitespecific/freeman/edls-migrate/staged",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        const rows = await storage.freemanEdlsMigrateStaging.listAll();
        res.json({ count: rows.length, rows });
      } catch (error) {
        res.status(500).json({
          message: failureMessage(error, "Failed to read the staged rows"),
        });
      }
    },
  );

  app.delete(
    "/api/sitespecific/freeman/edls-migrate/staged",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        const deleted = await storage.freemanEdlsMigrateStaging.deleteAll();
        res.json({ deleted });
      } catch (error) {
        res.status(500).json({
          message: failureMessage(error, "Failed to clear the staged rows"),
        });
      }
    },
  );
}

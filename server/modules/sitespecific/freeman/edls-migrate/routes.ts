/**
 * Admin routes for the Freeman EDLS migration connection.
 *
 * Both a settings report and the connection test itself. Gated exactly the way
 * the Teamsters 631 client routes are: authenticated, admin, EDLS enabled, and
 * this component enabled — the page is unreachable and the endpoints refuse
 * when the component is off.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import { storage } from "../../../../storage";
import { sendIfMaintenanceRefusal } from "../../../../services/maintenance-flag";
import {
  FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
  freemanEdlsMigratePing,
  getFreemanEdlsMigrateSettingsStatus,
  redactFreemanEdlsMigrateSecrets,
} from "./client";
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
  return redactFreemanEdlsMigrateSecrets(error instanceof Error ? error.message : fallback);
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

  app.get(
    "/api/sitespecific/freeman/edls-migrate/settings",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(getFreemanEdlsMigrateSettingsStatus());
      } catch (error) {
        res.status(500).json({
          message: failureMessage(error, "Failed to read migration settings"),
        });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/ping",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        // A failed ping is a successful report: the result carries the reason,
        // so the endpoint answers 200 and the page renders the diagnosis.
        res.json(await freemanEdlsMigratePing());
      } catch (error) {
        // A refusal is not a failed ping — nothing was asked — so it keeps its
        // own status and the shared wording.
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({ message: failureMessage(error, "Failed to run the ping") });
      }
    },
  );

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

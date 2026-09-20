/**
 * Admin routes for staging Freeman's legacy EDLS data.
 *
 * Connection configuration and testing live on the shared webclient-vendors
 * surface. These routes retain only the migration-specific source report,
 * sweeps, and staged-row management. They are authenticated, admin-only, and
 * gated on both EDLS and this site-specific component.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireComponent } from "../../../components";
import { storage } from "../../../../storage";
import { logger } from "../../../../logger";
import {
  isMaintenanceActive,
  sendIfMaintenanceRefusal,
} from "../../../../services/maintenance-flag";
import { FREEMAN_EDLS_MIGRATE_COMPONENT_ID } from "../../../../plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate";
import {
  FREEMAN_EDLS_FIELD_TABLES,
  FREEMAN_EDLS_NODE_TABLE,
  FREEMAN_EDLS_SHEET_NODE_TYPE,
  runFreemanEdlsFieldSweep,
  runFreemanEdlsNodeSweep,
} from "./sweep";
import {
  getFreemanMigrateStatus,
  assertNoActiveFreemanMigrate,
  resetFreemanMigrateStatus,
  runFreemanMigrate,
  startFreemanMigrate,
  stopFreemanMigrate,
  FreemanMigrateConflictError,
  withFreemanMigrateLock,
  getFreemanEdlsFullResetPreflight,
  executeFreemanEdlsFullReset,
  FreemanFullResetRefusedError,
  FreemanEdlsFullResetUnexpectedError,
} from "./import";

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

function sendMigrationFailure(res: Response, error: unknown, fallback: string): void {
  if (error instanceof FreemanMigrateConflictError) {
    res.status(409).json({ message: error.message });
    return;
  }
  res.status(500).json({ message: failureMessage(error, fallback) });
}

function databaseFailureMetadata(error: unknown): Record<string, unknown> {
  const source = error instanceof FreemanEdlsFullResetUnexpectedError
    ? error.cause
    : error;
  if (typeof source !== "object" || source === null) return {};
  const value = source as Record<string, unknown>;
  const allowed = ["name", "code", "constraint", "table", "schema", "routine"] as const;
  return Object.fromEntries(
    allowed
      .filter((key) => typeof value[key] === "string")
      .map((key) => [key, value[key]]),
  );
}

function sendFullResetFailure(res: Response, error: unknown): void {
  if (error instanceof FreemanMigrateConflictError) {
    res.status(409).json({ message: error.message, action: "refresh" });
    return;
  }
  if (error instanceof FreemanFullResetRefusedError) {
    res.status(409).json({ message: error.message, action: "refresh" });
    return;
  }

  const supportReference = randomUUID();
  const stage = error instanceof FreemanEdlsFullResetUnexpectedError
    ? error.stage
    : "reset_boundary";
  logger.error("Freeman EDLS full reset rolled back", {
    service: "freeman-edls-full-reset",
    supportReference,
    stage,
    outcome: "rolled_back",
    error: databaseFailureMetadata(error),
  });
  res.status(500).json({
    message: `The reset failed and was rolled back. Existing data was left unchanged. Contact support with reference ${supportReference}.`,
    action: "support",
    supportReference,
  });
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
  const freemanComponent = requireComponent("sitespecific.freeman");
  const migrateComponent = requireComponent(FREEMAN_EDLS_MIGRATE_COMPONENT_ID);
  const gate = [
    requireAuth,
    requirePermission("admin"),
    edlsComponent,
    freemanComponent,
    migrateComponent,
  ];

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
        await assertNoActiveFreemanMigrate();
        res.json(await withFreemanMigrateLock(runFreemanEdlsNodeSweep));
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        sendMigrationFailure(res, error, "Failed to sweep the legacy node table");
      }
    },
  );

  app.get(
    "/api/sitespecific/freeman/edls-migrate/full-reset",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await getFreemanEdlsFullResetPreflight());
      } catch (error) {
        sendMigrationFailure(res, error, "Failed to load full-reset counts");
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/full-reset",
    ...gate,
    async (req: Request, res: Response) => {
      if (isMaintenanceActive()) {
        res.status(503).json({
          message: "The Freeman EDLS full reset is unavailable while the site is in maintenance mode.",
          maintenance: true,
        });
        return;
      }
      try {
        res.json(await executeFreemanEdlsFullReset(req.body));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({
            message: "Type the exact confirmation phrase and refresh the reset counts before continuing.",
          });
          return;
        }
        sendFullResetFailure(res, error);
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/sweep/fields",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        await assertNoActiveFreemanMigrate();
        res.json(await withFreemanMigrateLock(runFreemanEdlsFieldSweep));
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        sendMigrationFailure(res, error, "Failed to sweep the legacy field tables");
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
        await assertNoActiveFreemanMigrate();
        const deleted = await withFreemanMigrateLock(
          () => storage.freemanEdlsMigrateStaging.deleteAll(),
        );
        res.json({ deleted });
      } catch (error) {
        sendMigrationFailure(res, error, "Failed to clear the staged rows");
      }
    },
  );

  app.get(
    "/api/sitespecific/freeman/edls-migrate/import/status",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await getFreemanMigrateStatus());
      } catch (error) {
        res.status(500).json({ message: failureMessage(error, "Failed to read migration progress") });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/import/start",
    ...gate,
    async (req: Request, res: Response) => {
      try {
        res.status(202).json(await startFreemanMigrate({ limit: req.body?.limit }));
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (error instanceof FreemanMigrateConflictError) {
          res.status(409).json({ message: error.message });
        } else {
          res.status(400).json({ message: failureMessage(error, "The live migration could not be started") });
        }
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/import/stop",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await stopFreemanMigrate());
      } catch (error) {
        res.status(500).json({ message: failureMessage(error, "Failed to request a safe stop") });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/import/reset",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(await resetFreemanMigrateStatus());
      } catch (error) {
        sendMigrationFailure(res, error, "Failed to reset migration progress");
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/import/run",
    ...gate,
    async (req: Request, res: Response) => {
      try {
        const mode = req.body?.mode;
        if (mode !== "test" && mode !== "live") {
          res.status(400).json({ message: "mode must be test or live" });
          return;
        }
        res.json(await runFreemanMigrate(mode, { limit: req.body?.limit }));
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (error instanceof FreemanMigrateConflictError) {
          res.status(409).json({ message: error.message });
          return;
        }
        res.status(400).json({
          message: failureMessage(error, "Failed to run Freeman migration"),
        });
      }
    },
  );
}

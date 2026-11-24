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
  isMaintenanceModeError,
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

type OneBatchFailureStage =
  | "request_validation"
  | "maintenance"
  | "conflict"
  | "database"
  | "request";
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
        res.set("Cache-Control", "private, no-store");
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
    async (req: Request, res: Response) => {
      try {
        res.json(await resetFreemanMigrateStatus(req.body));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Choose a valid start date on or after January 2, 1970." });
          return;
        }
        sendMigrationFailure(res, error, "Failed to reset migration progress");
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/import/run",
    ...gate,
    async (req: Request, res: Response) => {
      const correlationId = randomUUID();
      const endpoint = req.originalUrl || req.path;
      const mode = req.body?.mode;
      const limit = req.body?.limit;
      try {
        if (mode !== "test" && mode !== "live") {
          throw new z.ZodError([{
            code: "custom",
            path: ["mode"],
            message: "mode must be test or live",
          }]);
        }
        res.json(await runFreemanMigrate(mode, { limit }, { correlationId }));
      } catch (error) {
        sendOneBatchFailure(res, error, {
          correlationId,
          endpoint,
          mode,
          limit,
        });
      }
    },
  );
}

function isDatabaseError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) return true;
    current = value.cause;
  }
  return false;
}

function oneBatchFailure(error: unknown): {
  httpStatus: number;
  stage: OneBatchFailureStage;
  code: string;
  message: string;
  details?: string;
} {
  if (error instanceof z.ZodError) {
    return {
      httpStatus: 400,
      stage: "request_validation",
      code: "invalid_run_request",
      message: "The migration request was invalid.",
      details: error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  if (isMaintenanceModeError(error)) {
    return {
      httpStatus: error.statusCode,
      stage: "maintenance",
      code: "maintenance_refusal",
      message: error.message,
    };
  }
  if (error instanceof FreemanMigrateConflictError) {
    return {
      httpStatus: 409,
      stage: "conflict",
      code: "migration_already_running",
      message: error.message,
    };
  }
  if (isDatabaseError(error)) {
    return {
      httpStatus: 500,
      stage: "database",
      code: "database_failure",
      message: "The migration failed while reading or writing local data.",
    };
  }
  return {
    httpStatus: 500,
    stage: "request",
    code: "unexpected_migration_failure",
    message: "The migration request failed unexpectedly.",
  };
}

function sendOneBatchFailure(
  res: Response,
  error: unknown,
  context: {
    correlationId: string;
    endpoint: string;
    mode: unknown;
    limit: unknown;
  },
): void {
  const failure = oneBatchFailure(error);
  logger.error("Freeman EDLS one-batch migration failed", {
    service: "freeman-edls-migrate",
    ...context,
    stage: failure.stage,
    code: failure.code,
    error: safeUnexpectedError(error),
  });
  res.status(failure.httpStatus).json({
    success: false,
    message: failure.message,
    stage: failure.stage,
    code: failure.code,
    correlationId: context.correlationId,
    ...(failure.details ? { details: failure.details } : {}),
  });
}

function safeStackFrames(error: Error): string[] | undefined {
  const frames = error.stack
    ?.split("\n")
    .slice(1)
    .filter((line) => /^\s*at\s+/.test(line))
    .slice(0, 30)
    .map((line) => line.trim());
  return frames?.length ? frames : undefined;
}

function safeUnexpectedError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { valueType: typeof error };
  const value = error as Error & {
    code?: unknown;
    constraint?: unknown;
    table?: unknown;
    cause?: unknown;
  };
  const safeIdentifier = (candidate: unknown) =>
    typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(candidate)
      ? candidate
      : undefined;
  return {
    name: error.name,
    stackFrames: safeStackFrames(error),
    code: safeIdentifier(value.code),
    constraint: safeIdentifier(value.constraint),
    table: safeIdentifier(value.table),
    cause: value.cause instanceof Error
      ? {
        name: value.cause.name,
        stackFrames: safeStackFrames(value.cause),
      }
      : undefined,
  };
}

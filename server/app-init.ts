import express, { type Request, Response, NextFunction, type Express } from "express";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { addressValidationService } from "./services/address-validation";
import { logger } from "./logger";
import { setupAuth } from "./auth";
import { initAccessControl, registerEntityLoader } from "./services/access-policy-evaluator";
import { storage } from "./storage";
import { captureRequestContext } from "./middleware/request-context";
import { registerCronJob, bootstrapCronJobs, cronScheduler, deleteExpiredReportsHandler, deleteOldCronLogsHandler, processWmbBatchHandler, deleteExpiredFloodEventsHandler, deleteExpiredHfeHandler, sweepExpiredBanEligHandler, workerBanActiveScanHandler, workerCertificationActiveScanHandler, logCleanupHandler, memberStatusScanHandler } from "./cron";
import { loadComponentCache } from "./services/component-cache";
import { syncComponentPermissions } from "./services/component-permissions";
import { runMigrations } from "../scripts/migrate";
import { initializeWebSocket } from "./services/websocket";
import { getSession } from "./auth";

import "./charge-plugins";
import "./eligibility-plugins";
import "./services/providers";

import { registerFloodEvents, loadFloodConfigFromVariables } from "./flood";
import { initLogNotifier } from "./modules/log-notifier";
import { initializeDispatchEligSystem } from "./services/dispatch-elig-plugins";
import { initWorkerBanNotifications } from "./services/worker-ban-notifications";
import { initDispatchNotifications } from "./services/dispatch-notifications";
import "@shared/access-policies/loader";
import { registerEntityAccessModule } from "./modules/entity-access";
import { isComponentEnabled } from "./modules/components";

function redactSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') return data;
  
  const sensitiveFields = ['ssn', 'password', 'token', 'secret'];
  const redacted = Array.isArray(data) ? [...data] : { ...data };
  
  for (const key in redacted) {
    if (sensitiveFields.includes(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }
  
  return redacted;
}

export async function startApp(app: Express, server: Server, onReady: () => void): Promise<void> {
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        const logMessage = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        const meta: Record<string, any> = {
          source: "express",
          method: req.method,
          path,
          statusCode: res.statusCode,
          duration,
          ip: req.ip,
        };

        if (capturedJsonResponse) {
          try {
            const redactedResponse = redactSensitiveData(capturedJsonResponse);
            const fullRedactedString = JSON.stringify(redactedResponse);
            const preview = fullRedactedString.length > 100 
              ? fullRedactedString.slice(0, 99) + "…" 
              : fullRedactedString;
            meta.responsePreview = preview;
          } catch (err) {
            meta.responsePreview = "[Response serialization failed]";
          }
        }

        if (res.statusCode >= 500) {
          logger.error(logMessage, meta);
        } else if (res.statusCode >= 400) {
          logger.warn(logMessage, meta);
        } else {
          logger.http(logMessage, meta);
        }
      }
    });

    next();
  });

  initializePermissions();
  logger.info("Permission system initialized with core permissions", { source: "startup" });
  
  initAccessControl(
    {
      getUserPermissions: async (userId: string) => {
        const permissions = await storage.users.getUserPermissions(userId);
        return permissions.map(p => p.key);
      },
      hasPermission: async (userId: string, permissionKey: string) => {
        return storage.users.userHasPermission(userId, permissionKey);
      },
      getUser: async (userId: string) => {
        return storage.users.getUser(userId);
      },
    },
    storage,
    isComponentEnabled
  );
  logger.info("Access control system initialized", { source: "startup" });
  
  registerEntityLoader('edls_sheet', async (id: string, injectedStorage: any) => {
    const sheet = await injectedStorage.edlsSheets?.get?.(id);
    return sheet || null;
  });
  
  await addressValidationService.getConfig();
  logger.info("Address validation service initialized", { source: "startup" });

  const migrationResult = await runMigrations();
  if (migrationResult.ran > 0) {
    logger.info("Database migrations completed", { 
      source: "startup",
      ran: migrationResult.ran,
      skipped: migrationResult.skipped
    });
  } else {
    logger.debug("No pending migrations", { source: "startup" });
  }
  if (migrationResult.errors.length > 0) {
    logger.error("Migration errors occurred", {
      source: "startup",
      errors: migrationResult.errors
    });
  }

  await loadComponentCache();
  logger.info("Component cache initialized", { source: "startup" });

  syncComponentPermissions();
  logger.info("Component permissions synced", { source: "startup" });

  await initializeDispatchEligSystem();
  logger.info("Dispatch eligibility system initialized", { source: "startup" });

  initWorkerBanNotifications();
  logger.info("Worker ban notifications initialized", { source: "startup" });

  initDispatchNotifications();
  logger.info("Dispatch notifications initialized", { source: "startup" });

  registerCronJob('delete-expired-reports', deleteExpiredReportsHandler);
  registerCronJob('delete-old-cron-logs', deleteOldCronLogsHandler);
  registerCronJob('process-wmb-batch', processWmbBatchHandler);
  registerCronJob('delete-expired-flood-events', deleteExpiredFloodEventsHandler);
  registerCronJob('delete-expired-hfe', deleteExpiredHfeHandler);
  registerCronJob('sweep-expired-ban-elig', sweepExpiredBanEligHandler);
  registerCronJob('worker-ban-active-scan', workerBanActiveScanHandler);
  registerCronJob('worker-certification-active-scan', workerCertificationActiveScanHandler);
  registerCronJob('log-cleanup', logCleanupHandler);
  registerCronJob('member-status-scan', memberStatusScanHandler);
  logger.info("Cron job handlers registered", { source: "startup" });

  registerFloodEvents();
  logger.info("Flood events registered", { source: "startup" });

  await loadFloodConfigFromVariables();
  logger.info("Flood configs loaded from variables", { source: "startup" });

  initLogNotifier();

  await bootstrapCronJobs();
  logger.info("Default cron jobs bootstrapped", { source: "startup" });

  await setupAuth(app);
  logger.info("Authentication system initialized", { source: "startup" });

  app.use(captureRequestContext);

  registerEntityAccessModule(app, storage);
  logger.info("Entity access module registered", { source: "startup" });

  await registerRoutes(app, server);

  const sessionMiddleware = getSession();
  initializeWebSocket(server, sessionMiddleware);
  logger.info("WebSocket server initialized", { source: "startup" });

  try {
    await cronScheduler.start();
    logger.info("Cron scheduler started", { source: "startup" });
  } catch (error) {
    logger.error("Failed to start cron scheduler", {
      source: "startup",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    logger.error(`Error: ${message}`, {
      source: "express",
      statusCode: status,
      error: err.stack || err.toString(),
      url: _req.url,
      method: _req.method,
    });

    res.status(status).json({ message });
  });

  serveStatic(app);

  onReady();
  logger.info("Application fully initialized and ready", { source: "startup" });
}

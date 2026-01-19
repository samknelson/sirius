import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { addressValidationService } from "./services/address-validation";
import { logger } from "./logger";
import { setupAuth } from "./auth";
import { initAccessControl, registerEntityLoader } from "./services/access-policy-evaluator";
import { storage } from "./storage";
import { captureRequestContext } from "./middleware/request-context";
import { registerCronJob, bootstrapCronJobs, cronScheduler, deleteExpiredReportsHandler, deleteOldCronLogsHandler, processWmbBatchHandler, deleteExpiredFloodEventsHandler, deleteExpiredHfeHandler, sweepExpiredBanEligHandler, workerBanActiveScanHandler, workerCertificationActiveScanHandler, logCleanupHandler } from "./cron";
import { loadComponentCache } from "./services/component-cache";
import { syncComponentPermissions } from "./services/component-permissions";
import { runMigrations } from "../scripts/migrate";
import { initializeWebSocket } from "./services/websocket";
import { getSession } from "./auth";

// Import charge plugins module to trigger registration
// Note: Individual plugins are registered in ./charge-plugins/index.ts
import "./charge-plugins";
import { registerChargePluginListeners } from "./charge-plugins";

// Import eligibility plugins module to trigger registration
// Note: Individual plugins are registered in ./eligibility-plugins/index.ts
import "./eligibility-plugins";

// Import service providers module to trigger registration
// Note: SMS, Email, and other providers are registered here
import "./services/providers";

// Import and register flood events
import { registerFloodEvents, loadFloodConfigFromVariables } from "./flood";

// Import log notifier module
import { initLogNotifier } from "./modules/log-notifier";

// Import dispatch eligibility plugins system
import { initializeDispatchEligSystem } from "./services/dispatch-elig-plugins";

// Import worker ban notifications
import { initWorkerBanNotifications } from "./services/worker-ban-notifications";

// Import modular access policies (triggers registration via loader)
import "@shared/access-policies/loader";
import { registerEntityAccessModule } from "./modules/entity-access";
import { isComponentEnabled } from "./modules/components";

// Helper function to redact sensitive data from responses before logging
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

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
        // Redact sensitive data and create a preview string
        // Important: Only store the string, never the object, to prevent PII leaks
        try {
          const redactedResponse = redactSensitiveData(capturedJsonResponse);
          const fullRedactedString = JSON.stringify(redactedResponse);
          const preview = fullRedactedString.length > 100 
            ? fullRedactedString.slice(0, 99) + "…" 
            : fullRedactedString;
          // Store only the string preview, not the object
          meta.responsePreview = preview;
        } catch (err) {
          // If serialization fails, log minimal info
          meta.responsePreview = "[Response serialization failed]";
        }
      }

      // Log at appropriate level based on status code
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

(async () => {
  // Initialize the permission system
  initializePermissions();
  logger.info("Permission system initialized with core permissions", { source: "startup" });
  
  // Initialize access control system with unified policy evaluator
  initAccessControl(
    // Access control storage interface
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
    // Full storage for entity loaders
    storage,
    // Component flag checker
    isComponentEnabled
  );
  logger.info("Access control system initialized", { source: "startup" });
  
  // Register entity loaders for policies that use cacheKeyFields
  registerEntityLoader('edls_sheet', async (id: string, injectedStorage: any) => {
    const sheet = await injectedStorage.edlsSheets?.get?.(id);
    return sheet || null;
  });
  
  // Initialize address validation service (loads or creates config)
  await addressValidationService.getConfig();
  logger.info("Address validation service initialized", { source: "startup" });

  // Run database migrations
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

  // Load component cache
  await loadComponentCache();
  logger.info("Component cache initialized", { source: "startup" });

  // Register permissions from enabled components
  syncComponentPermissions();
  logger.info("Component permissions synced", { source: "startup" });

  // Initialize dispatch eligibility plugin system
  await initializeDispatchEligSystem();
  logger.info("Dispatch eligibility system initialized", { source: "startup" });

  // Initialize worker ban notifications
  initWorkerBanNotifications();
  logger.info("Worker ban notifications initialized", { source: "startup" });

  // Register charge plugin event listeners
  // Note: Charge plugins are currently called directly from storage for backwards compatibility.
  // The listener is available for future use when we fully migrate to event-driven execution.
  // registerChargePluginListeners();

  // Register cron job handlers
  registerCronJob('delete-expired-reports', deleteExpiredReportsHandler);
  registerCronJob('delete-old-cron-logs', deleteOldCronLogsHandler);
  registerCronJob('process-wmb-batch', processWmbBatchHandler);
  registerCronJob('delete-expired-flood-events', deleteExpiredFloodEventsHandler);
  registerCronJob('delete-expired-hfe', deleteExpiredHfeHandler);
  registerCronJob('sweep-expired-ban-elig', sweepExpiredBanEligHandler);
  registerCronJob('worker-ban-active-scan', workerBanActiveScanHandler);
  registerCronJob('worker-certification-active-scan', workerCertificationActiveScanHandler);
  registerCronJob('log-cleanup', logCleanupHandler);
  logger.info("Cron job handlers registered", { source: "startup" });

  // Register flood events
  registerFloodEvents();
  logger.info("Flood events registered", { source: "startup" });

  // Load custom flood configurations from variables
  await loadFloodConfigFromVariables();
  logger.info("Flood configs loaded from variables", { source: "startup" });

  // Initialize log notifier (listens to LOG events for conditional in-app alerts)
  initLogNotifier();

  // Bootstrap default cron jobs
  await bootstrapCronJobs();
  logger.info("Default cron jobs bootstrapped", { source: "startup" });

  // Setup multi-provider auth
  await setupAuth(app);
  logger.info("Authentication system initialized", { source: "startup" });

  // Setup request context middleware (captures user and IP for logging)
  app.use(captureRequestContext);

  // Register entity access module
  registerEntityAccessModule(app, storage);
  logger.info("Entity access module registered", { source: "startup" });

  const server = await registerRoutes(app);

  // Initialize WebSocket server for real-time notifications
  const sessionMiddleware = getSession();
  initializeWebSocket(server, sessionMiddleware);
  logger.info("WebSocket server initialized", { source: "startup" });

  // Start cron scheduler after routes are registered
  try {
    await cronScheduler.start();
    logger.info("Cron scheduler started", { source: "startup" });
  } catch (error) {
    logger.error("Failed to start cron scheduler", {
      source: "startup",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Register error handling middleware AFTER routes to catch route errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error with Winston
    logger.error(`Error: ${message}`, {
      source: "express",
      statusCode: status,
      error: err.stack || err.toString(),
      url: _req.url,
      method: _req.method,
    });

    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();

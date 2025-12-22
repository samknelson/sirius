import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { addressValidationService } from "./services/address-validation";
import { logger } from "./logger";
import { setupAuth } from "./replitAuth";
import { initAccessControl } from "./accessControl";
import { storage } from "./storage";
import { captureRequestContext } from "./middleware/request-context";
import { registerCronJob, bootstrapCronJobs, cronScheduler, deleteExpiredReportsHandler, deleteOldCronLogsHandler, processWmbBatchHandler, deleteExpiredFloodEventsHandler } from "./cron";
import { loadComponentCache } from "./services/component-cache";
import { runMigrations } from "../scripts/migrate";
import { initializeWebSocket } from "./services/websocket";
import { getSession } from "./replitAuth";

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
  
  // Initialize access control system
  initAccessControl({
    getUserPermissions: async (userId: string) => {
      const permissions = await storage.users.getUserPermissions(userId);
      return permissions.map(p => p.key);
    },
    hasPermission: async (userId: string, permissionKey: string) => {
      return storage.users.userHasPermission(userId, permissionKey);
    },
    getUserByReplitId: async (replitUserId: string) => {
      return storage.users.getUserByReplitId(replitUserId);
    },
    getUser: async (userId: string) => {
      return storage.users.getUser(userId);
    },
  });
  logger.info("Access control system initialized", { source: "startup" });
  
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

  // Register charge plugin event listeners
  // Note: Charge plugins are currently called directly from storage for backwards compatibility.
  // The listener is available for future use when we fully migrate to event-driven execution.
  // registerChargePluginListeners();

  // Register cron job handlers
  registerCronJob('delete-expired-reports', deleteExpiredReportsHandler);
  registerCronJob('delete-old-cron-logs', deleteOldCronLogsHandler);
  registerCronJob('process-wmb-batch', processWmbBatchHandler);
  registerCronJob('delete-expired-flood-events', deleteExpiredFloodEventsHandler);
  logger.info("Cron job handlers registered", { source: "startup" });

  // Register flood events
  registerFloodEvents();
  logger.info("Flood events registered", { source: "startup" });

  // Load custom flood configurations from variables
  await loadFloodConfigFromVariables();
  logger.info("Flood configs loaded from variables", { source: "startup" });

  // Bootstrap default cron jobs
  await bootstrapCronJobs();
  logger.info("Default cron jobs bootstrapped", { source: "startup" });

  // Setup Replit Auth
  await setupAuth(app);
  logger.info("Replit Auth initialized", { source: "startup" });

  // Setup request context middleware (captures user and IP for logging)
  app.use(captureRequestContext);

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

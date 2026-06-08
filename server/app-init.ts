import express, { type Request, Response, NextFunction, type Express } from "express";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { addressValidationService } from "./services/comm/validators/address";
import { logger } from "./logger";
import { setupAuth } from "./auth";
import { initAccessControl, registerEntityLoader } from "./services/access-policy-evaluator";
import { storage } from "./storage";
import { captureRequestContext } from "./middleware/request-context";
import { registerCronJob, bootstrapCronJobs, cronScheduler, deleteExpiredReportsHandler, deleteOldCronLogsHandler, processWmbBatchHandler, deleteExpiredFloodEventsHandler, deleteExpiredHfeHandler, sweepExpiredBanEligHandler, workerBanActiveScanHandler, workerCertificationActiveScanHandler, logCleanupHandler, memberStatusScanHandler, dispatchEbaCleanupHandler, dispatchJobPollHandler, bulkDeliverHandler, t631DispatchJobGroupFetchHandler, t631FacilityFetchHandler, t631TosFetchHandler, gbhetPensionSlaReconcileHandler, gbhetPensionSharesReconcileHandler } from "./cron";
import { initDispatchSeniorityReset } from "./services/dispatch/seniority-reset";
import { loadComponentCache } from "./services/component-cache";
import { syncComponentPermissions } from "./services/component-permissions";
import { runMigrations } from "../scripts/migrate";
import { enforceStartupSchemaDrift } from "./services/schema-drift-check";
import { runPendingComponentMigrationsAtStartup } from "./services/migration-runner";
import { initializeWebSocket } from "./services/websocket";
import { getSession } from "./auth";

// Side-effect imports: trigger plugin / provider / access-policy registration.
import "./plugins/ledger/charge";
import { registerWmbChargePluginListener } from "./plugins/ledger/charge";
import "./plugins/ledger/payment-gateway";
import "./plugins/trust/eligibility";
import "./services/comm/providers";

import { registerFloodEvents, loadFloodConfigFromVariables } from "./flood";
import { initLogNotifier } from "./modules/log-notifier";
import { initializeDispatchEligSystem } from "./plugins/dispatch/eligibility";
import { initializeDashboardPluginSystem } from "./plugins/dashboard";
import { initializeClientInjectionPluginSystem } from "./plugins/client-injection";
import { initWorkerBanNotifications } from "./services/worker-ban-notifications";
import { initDispatchNotifications } from "./services/dispatch/notifications";
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

/**
 * Install the base Express middleware shared by every entry point:
 * JSON/urlencoded body parsing and the API request-logging middleware
 * (with response redaction). Registered before the heavy init sequence so
 * requests that arrive during startup are parsed/logged consistently.
 */
function installBaseMiddleware(app: Express): void {
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
          // Redact sensitive data and create a preview string.
          // Important: Only store the string, never the object, to prevent PII leaks.
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
}

/**
 * Run the complete, ordered application initialization sequence shared by
 * BOTH entry points:
 *   - dev:  `server/index.ts` (tsx, `npm run dev`)
 *   - prod: `server/production-entry.ts` -> `startApp()` (`npm run start`)
 *
 * This is the single source of truth for boot-time wiring. Add any new
 * startup step (plugin-kind registration, reconcile/materialization loop,
 * registry init, cron handler, event listener, etc.) HERE so it runs
 * identically in both environments. Adding it to only one entry point makes
 * a feature silently work in one environment and not the other.
 *
 * Covers everything from base middleware through the error-handling
 * middleware. The frontend-serving step (Vite in dev vs static in prod) and
 * the "ready" signal are intentionally left to each entry point.
 */
export async function bootstrapApp(app: Express, server: Server): Promise<void> {
  installBaseMiddleware(app);

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
  registerEntityLoader('dispatch', async (id: string, injectedStorage: any) => {
    const dispatch = await injectedStorage.dispatches?.get?.(id);
    return dispatch || null;
  });

  registerEntityLoader('edls_sheet', async (id: string, injectedStorage: any) => {
    const sheet = await injectedStorage.edlsSheets?.get?.(id);
    return sheet || null;
  });

  // Initialize dispatch seniority reset
  initDispatchSeniorityReset();
  logger.info("Dispatch seniority reset initialized", { source: "startup" });

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

  // Run any pending per-component migrations for components that are already
  // enabled. Without this, a new component migration would never run for
  // already-enabled components, and the startup drift gate below would refuse
  // to boot. New components still run migrations via the enable flow.
  await runPendingComponentMigrationsAtStartup();

  // Refuse to boot if the live database has drifted from the expected schema
  // (core + every enabled schema-managing component). See
  // `server/services/schema-drift-check.ts` for the rationale and the
  // SKIP_SCHEMA_DRIFT_CHECK=1 dev escape hatch.
  await enforceStartupSchemaDrift();

  // Register permissions from enabled components
  syncComponentPermissions();
  logger.info("Component permissions synced", { source: "startup" });

  // Initialize dispatch eligibility plugin system
  await initializeDispatchEligSystem();
  logger.info("Dispatch eligibility system initialized", { source: "startup" });

  // Initialize dashboard plugin system (registration + legacy migrations)
  await initializeDashboardPluginSystem();
  logger.info("Dashboard plugin system initialized", { source: "startup" });

  // Initialize client-injection plugin system (registration + adapter)
  await initializeClientInjectionPluginSystem();
  logger.info("Client-injection plugin system initialized", { source: "startup" });

  // Materialize component-owned plugin_configs for components that are already
  // enabled (Task #397). Idempotent: existing rows are left untouched (admin
  // edits preserved), only missing rows are created and disabled-but-present
  // rows are re-activated. Mirrors the PUT-handler reconcile for the boot path.
  {
    const { getAllComponents } = await import("../shared/components");
    const { reconcileComponentPluginConfigs } = await import(
      "./services/component-lifecycle"
    );
    for (const component of getAllComponents()) {
      if (!component.pluginConfigs?.length) continue;
      if (await isComponentEnabled(component.id)) {
        await reconcileComponentPluginConfigs(component.id, true);
      }
    }
  }
  logger.info("Component-owned plugin configs reconciled", { source: "startup" });

  // Register charge + trust eligibility kinds with the unified
  // /api/plugins/:kind/manifest endpoint (Task #208). Dashboard +
  // dispatch eligibility register themselves inside their init fns above.
  const { registerChargePluginKind } = await import("./plugins/ledger/charge");
  const { registerTrustEligibilityKind } = await import("./plugins/trust/eligibility");
  const { registerPaymentGatewayPluginKind } = await import("./plugins/ledger/payment-gateway");
  registerChargePluginKind();
  registerTrustEligibilityKind();
  registerPaymentGatewayPluginKind();

  // Initialize worker ban notifications
  initWorkerBanNotifications();
  logger.info("Worker ban notifications initialized", { source: "startup" });

  // Initialize dispatch notifications
  initDispatchNotifications();
  logger.info("Dispatch notifications initialized", { source: "startup" });

  // Register charge plugin event listeners.
  // WMB charges are fully event-driven: trust.wmb storage emits WMB_SAVED and
  // this listener runs the WMB charge plugins. Only the WMB listener is enabled
  // here — HOURS/PAYMENT/PARTICIPANT/CRON charge plugins are still invoked
  // directly from their own write paths, so registering the full
  // registerChargePluginListeners() would double-charge them.
  registerWmbChargePluginListener();

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
  registerCronJob('member-status-scan', memberStatusScanHandler);
  registerCronJob('dispatch-eba-cleanup', dispatchEbaCleanupHandler);
  registerCronJob('dispatch-job-poll', dispatchJobPollHandler);
  registerCronJob('bulk-deliver', bulkDeliverHandler);
  registerCronJob('sitespecific-t631-dispatch-job-group-fetch', t631DispatchJobGroupFetchHandler);
  registerCronJob('sitespecific-t631-facility-fetch', t631FacilityFetchHandler);
  registerCronJob('sitespecific-t631-tos-fetch', t631TosFetchHandler);
  registerCronJob('gbhet-pension-sla-reconcile', gbhetPensionSlaReconcileHandler);
  registerCronJob('gbhet-pension-shares-reconcile', gbhetPensionSharesReconcileHandler);
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

  await registerRoutes(app, server);

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
}

/**
 * Production entry helper: run the shared bootstrap sequence, serve the
 * pre-built static frontend, then signal readiness. Used by
 * `server/production-entry.ts`. Dev (`server/index.ts`) calls
 * `bootstrapApp` directly so it can wire up Vite instead.
 */
export async function startApp(app: Express, server: Server, onReady: () => void): Promise<void> {
  await bootstrapApp(app, server);

  serveStatic(app);

  onReady();
  logger.info("Application fully initialized and ready", { source: "startup" });
}

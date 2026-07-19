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
import { cronScheduler } from "./cron";
import { initializeCronPluginSystem } from "./plugins/system/cron";
import { initializeDenormPluginSystem } from "./plugins/system/denorm";
import { bootstrapSingletonPluginConfigs } from "./plugins/_core";
import { initDispatchSeniorityReset } from "./services/dispatch/seniority-reset";
import { loadComponentCache } from "./services/component-cache";
import { syncComponentPermissions } from "./services/component-permissions";
import { runMigrations } from "../scripts/migrate";
import { ensureEmptyDatabaseBootstrap } from "./services/empty-db-bootstrap";
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
import { initializeDispatchEligSystem } from "./plugins/dispatch/eligibility";
import { initializeDashboardPluginSystem } from "./plugins/dashboard";
import { initializeClientInjectionPluginSystem } from "./plugins/client-injection";
import { initializeEventNotifierPluginSystem } from "./plugins/event-notifier";
import { initializeWizardPluginSystem } from "./plugins/wizards";
import { initializeMenuPluginSystem } from "./plugins/menu";
import { initWorkerBanNotifications } from "./services/worker-ban-notifications";
import { initSnapshotCapture } from "./services/snapshots/capture";
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

  // Detect a completely empty database BEFORE anything touches it. With
  // ALLOW_EMPTY_DB_BOOTSTRAP=1 this creates the full schema from the Drizzle
  // definitions and stamps migration bookkeeping; without it, an empty DB
  // fails with a clear operator error. Non-empty databases: strict no-op.
  await ensureEmptyDatabaseBootstrap();

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

  // Initialize event-notifier plugin system (registration + adapter)
  initializeEventNotifierPluginSystem();
  logger.info("Event-notifier plugin system initialized", { source: "startup" });

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
  const {
    registerPaymentGatewayPluginKind,
    backfillPaymentGatewaySubsidiaries,
    backfillPaymentTypesFromGlobal,
  } = await import("./plugins/ledger/payment-gateway");
  registerChargePluginKind();
  registerTrustEligibilityKind();
  registerPaymentGatewayPluginKind();
  // Every payment-gateway config needs a subsidiary row (the generic search
  // inner-joins it). Backfill pre-existing configs so they don't vanish.
  await backfillPaymentGatewaySubsidiaries();
  logger.info("Payment-gateway subsidiaries backfilled", { source: "startup" });

  // Wire the shared plugin-config cache's invalidation subscription before any
  // config writes matter. The cache is generic (per-kind) and lazy; this only
  // registers its single PLUGIN_CONFIG_SAVED listener.
  {
    const { initializePluginConfigCache } = await import(
      "./plugins/_core/plugin-config-cache"
    );
    initializePluginConfigCache();
  }
  logger.info("Plugin-config cache initialized", { source: "startup" });

  // Every event-notifier config needs a subsidiary row (the generic search
  // inner-joins it). Backfill pre-existing configs, then subscribe the
  // dispatcher to the bus so fired events fan out to enabled configs.
  {
    const { backfillEventNotifierSubsidiaries } = await import(
      "./plugins/event-notifier"
    );
    const { initializeEventNotifierDispatcher } = await import(
      "./plugins/event-notifier/dispatcher"
    );
    await backfillEventNotifierSubsidiaries();
    initializeEventNotifierDispatcher();
  }
  logger.info("Event-notifier dispatcher initialized", { source: "startup" });
  // Migrate the legacy global `stripe_payment_methods` variable onto each
  // gateway config's own `data.paymentTypes`, then retire the global.
  await backfillPaymentTypesFromGlobal();
  logger.info("Payment types migrated off legacy global variable", { source: "startup" });

  // Initialize worker ban notifications
  initWorkerBanNotifications();
  initSnapshotCapture();
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

  // Register cron plugins (kind + adapter + self-registering plugin imports)
  initializeCronPluginSystem();
  logger.info("Cron plugins registered", { source: "startup" });

  // Register denorm plugins (kind + adapter + self-registering plugin imports)
  initializeDenormPluginSystem();
  logger.info("Denorm plugins registered", { source: "startup" });

  // Register wizards as the sixth plugin kind (self-registering plugin imports)
  initializeWizardPluginSystem();
  logger.info("Wizard plugins registered", { source: "startup" });

  // Register menu plugins (pluggable main navigation)
  initializeMenuPluginSystem();
  logger.info("Menu plugins registered", { source: "startup" });

  // Register flood events
  registerFloodEvents();
  logger.info("Flood events registered", { source: "startup" });

  // Load custom flood configurations from variables
  await loadFloodConfigFromVariables();
  logger.info("Flood configs loaded from variables", { source: "startup" });

  // Seed singleton plugin configs (e.g. cron jobs) that have no config row yet
  await bootstrapSingletonPluginConfigs();
  logger.info("Singleton plugin configs bootstrapped", { source: "startup" });

  // Seed the local-auth credential from LOCAL_AUTH_EMAIL /
  // LOCAL_AUTH_PASSWORD_HASH (no-op when unset). Must run after migrations
  // and before auth setup so the credential is usable on first login.
  {
    const { seedLocalCredential } = await import("./auth/local-seed");
    await seedLocalCredential();
  }

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
      headersSent: res.headersSent,
    });

    // If headers were already sent (e.g. async Set-Cookie raced with the
    // response writer), writing a JSON body throws and falls through to
    // Express's default handler — which emits a plain-text "Internal Server
    // Error" page. End the connection cleanly instead.
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        // ignore
      }
      return;
    }

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

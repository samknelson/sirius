import express, { type Request, Response, NextFunction, type Express } from "express";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { assertNoteEntityTablesComplete } from "./storage/notes-entity-types";
import { addressValidationService } from "./services/comm/validators/address";
import { logger } from "./logger";
import { setupAuth } from "./auth";
import { initAccessControl, registerEntityLoader } from "./services/access-policy-evaluator";
import { storage } from "./storage";
import { captureRequestContext } from "./middleware/request-context";
import { installWebServiceMaintenanceGate } from "./modules/webservices/maintenance";
import { cronScheduler } from "./cron";
import { initializeCronPluginSystem } from "./plugins/system/cron";
import { initializeDenormPluginSystem } from "./plugins/system/denorm";
import { initializeDataRetentionPluginSystem } from "./plugins/system/data-retention";
import { initializeSystemStatusPluginSystem } from "./plugins/system/status";
import { bootstrapSingletonPluginConfigs } from "./plugins/_core";
import { initDispatchSeniorityReset } from "./services/dispatch/seniority-reset";
import { runSchemaBringUp } from "./services/bringup";
import { syncComponentPermissions } from "./services/component-permissions";
import { initializeWebSocket } from "./services/websocket";
import { getSession } from "./auth";

// Side-effect imports: trigger plugin / provider / access-policy registration.
import "./plugins/ledger/charge";
import { registerWmbChargePluginListener, registerCobraElectionChargeListener } from "./plugins/ledger/charge";
import "./plugins/ledger/payment-gateway";
import "./plugins/trust/eligibility";
import "./services/comm/providers";

import { registerFloodEvents, loadFloodConfigFromVariables } from "./flood";
import { initializeDispatchEligSystem } from "./plugins/dispatch/eligibility";
import { initializeDashboardPluginSystem } from "./plugins/dashboard";
import { initializeQuicksearchPluginSystem } from "./plugins/quicksearch";
import { initializeClientInjectionPluginSystem } from "./plugins/client-injection";
import { initializeEventNotifierPluginSystem } from "./plugins/event-notifier";
import { initializeWizardPluginSystem } from "./plugins/wizards";
import { initializeTrustProviderEdiSystem } from "./plugins/trust/provider-edi";
import { initializeMenuPluginSystem } from "./plugins/menu";
import { initializeTokenPluginSystem } from "./plugins/tokens";
import { initWorkerBanNotifications } from "./services/worker-ban-notifications";
import { initDispatchNotifications } from "./services/dispatch/notifications";
import { initWmbAutoRescan } from "./services/wmb-auto-rescan";
import { initBaoCobraAutoCase } from "./services/bao-cobra-auto-case";
import { initBaoDpAutoRescan } from "./services/bao-dp-auto-rescan";
import { initDcGrantReconciliation } from "./services/sitespecific/bao/dc-grant";
import "@shared/access-policies/loader";
import { registerEntityAccessModule } from "./modules/entity-access";
import { isComponentEnabled } from "./modules/components";
import {
  createS1WriteFenceMiddleware,
  installS1WriteFenceHandlerTracking,
} from "./middleware/s1-write-fence";

// Helper function to redact sensitive data from responses before logging.
// Exported so the redaction list can be asserted directly — the fields it
// covers are a security boundary, not an implementation detail.
export function redactSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') return data;

  // `accesscode` / `accessuuid` are the worker.aat access-token pair: they are
  // bearer-like credentials (a future link is authorized by the UUID alone),
  // so they must never reach a response preview in the admin log viewer.
  const sensitiveFields = ['ssn', 'password', 'token', 'secret', 'accesscode', 'accessuuid'];
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
  // Fence before body parsing so a wet sync rejects large mutating requests
  // without spending time or memory decoding payloads that cannot be handled.
  app.use(createS1WriteFenceMiddleware());
  // Before the parsers, deliberately: while the site is in maintenance mode
  // every web service call is refused outright, and a malformed or oversized
  // body must not be answered "your request is bad" when the real answer is
  // "the site is down". Scoped to the web service mount; the site itself stays
  // browsable during maintenance.
  installWebServiceMaintenanceGate(app);

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

        // PII triage (accepted): request meta may include the client IP.
        // IPs are retained in request logs for abuse investigation and
        // security auditing; response bodies are redacted above.
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
  // FIRST, before anything reads a clock or writes a row. Every naive
  // timestamp column stores a wall-clock reading in this process's zone, so
  // the zone has to be settled before the schema bring-up, the first
  // migration and the first defaulted row — not merely before the app serves
  // traffic. A zone applied afterwards cannot repair rows already written in
  // the container's zone. Throws on an unrecognised zone name rather than
  // letting Node silently ignore it and run the whole site in UTC.
  //
  // TZ may be supplied by an in-app override rather than the environment, and
  // overrides live in the database — so this reads that ONE row directly
  // instead of waiting for the override cache, which is not installed until
  // after the migrations have already written timestamps. The peek is
  // fail-soft: an unreachable or not-yet-created variables table is the schema
  // bring-up's failure to report, not this step's.
  {
    const { applySystemTimeZone } = await import("./config/system-timezone");
    let applied = applySystemTimeZone();
    if (!applied.configured) {
      const { peekEnvOverride } = await import("./services/env-overrides");
      const stored = await peekEnvOverride("TZ");
      if (stored) applied = applySystemTimeZone(() => stored);
    }
    // Name the SOURCE, not just the zone: the S1→S2 cutover checklist
    // (scripts/s1-migration/RUNBOOK.md §1 "Time zone pin", §12 step 0) accepts
    // a deployment-supplied TZ as evidence and rejects the other two, so this
    // one line has to be enough to tick or fail the item from a log alone.
    const provenance =
      applied.source === "environment"
        ? "from TZ in the environment"
        : applied.source === "override"
          ? "from the in-app ENV_TZ override — the deployment sets no TZ"
          : "TZ unset — using the container default";
    logger.info(`System time zone: ${applied.zone} (${provenance})`, {
      source: "startup",
      timeZone: applied.zone,
      configured: applied.configured,
      timeZoneSource: applied.source,
    });
  }

  installBaseMiddleware(app);
  // Express 4 does not await async route handlers. Track their returned
  // promises so an aborted mutation retains its fence until handler work ends.
  installS1WriteFenceHandlerTracking(app);

  // Fail fast when a note-able record type declared in shared/notes.ts has no
  // table binding: without one the orphan sweep would silently skip its notes.
  assertNoteEntityTablesComplete();

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

  // Schema bring-up, as ONE phase: classify the database, bootstrap it if it
  // is empty and allowed, apply core migrations (a failure here is fatal —
  // the app must never reach the drift gate half-migrated), load the
  // component cache, apply per-component migrations, and enforce the drift
  // gate. It prints the bring-up report exactly once, on success and on
  // failure alike, and under BRINGUP_REPORT_ONLY=1 it reports and stops
  // without writing anything. See `server/services/bringup.ts`.
  await runSchemaBringUp();

  // Initialize address validation service (loads or creates config). Runs
  // after bring-up: it writes a config row, which report-only mode must not
  // do, and it has nothing to say about the schema.
  await addressValidationService.getConfig();
  logger.info("Address validation service initialized", { source: "startup" });

  // Arm maintenance-mode enforcement (connection-level read-only lock while
  // system_mode = "maintenance"). Armed ONLY here — standalone scripts that
  // import the db module directly stay writable by design. Must run after
  // migrations/drift (needs the variables table) and before routes/crons.
  {
    const { armMaintenanceEnforcement } = await import("./services/maintenance-mode");
    await armMaintenanceEnforcement();
  }

  // Load DB-backed environment-variable overrides and install the sync
  // fallback into the env registry (real env values always win). Must run
  // after migrations (needs the variables table) and before any init step
  // that reads overridable variables (e.g. FILESYSTEMS, auth setup).
  {
    const { initEnvOverrides } = await import("./services/env-overrides");
    await initEnvOverrides();

    // Safety net, normally a no-op: the stored override was already read
    // directly at the top of this function. It fires only if the peek could
    // not reach the database while the bring-up could. Still safe to move the
    // zone here — the cron scheduler has not been started and no
    // request-serving formatter exists yet — but anything written in between
    // is already in the old zone, which is why the early peek exists. Pooled
    // database sessions realign on their next checkout (server/storage/db.ts).
    {
      const { applySystemTimeZone } = await import("./config/system-timezone");
      const applied = applySystemTimeZone();
      if (applied.changed) {
        logger.warn(
          `System time zone moved to ${applied.zone} only after the schema bring-up; ` +
            `any timestamps written during bring-up are in the previous zone`,
          { source: "startup", timeZone: applied.zone },
        );
      }
    }

    // Task #1258. Refuse to boot when the reloadable-subsystem registry and
    // the per-variable change-effect classification disagree — otherwise the
    // Environment Variables page and the Restart & Reload page would tell an
    // operator different things about the same variable.
    const { assertReloadClassificationConsistency } = await import(
      "./services/reload-registry"
    );
    assertReloadClassificationConsistency();

    // Baseline the effective value of every restart-only variable, so the
    // Restart & Reload page can report which ones are genuinely WAITING on a
    // restart rather than merely capable of needing one. Must run after the
    // overrides are installed: an override present at boot is part of what
    // this process is already using.
    const { captureRestartBaseline } = await import("./services/env-restart-pending");
    captureRestartBaseline();
  }

  // Initialize environment-defined filesystems (FILESYSTEMS env var).
  // Throws on malformed config; warns for any file_system_id referenced by
  // files rows but absent from the environment.
  {
    const { initFileSystems } = await import("./services/files");
    const referencedIds = await storage.files.listDistinctFileSystemIds();
    initFileSystems(referencedIds);
    logger.info("Filesystem registry initialized", { source: "startup" });
  }

  // Register permissions from enabled components
  syncComponentPermissions();
  logger.info("Component permissions synced", { source: "startup" });

  // Initialize dispatch eligibility plugin system
  await initializeDispatchEligSystem();
  logger.info("Dispatch eligibility system initialized", { source: "startup" });

  // Initialize the worker-ban plugin framework (kind + built-in plugins),
  // seed the default "Dispatch" ban type and migrate legacy dispatch bans.
  {
    const { initializeWorkerBanSystem, seedWorkerBanTypes } = await import(
      "./plugins/worker-bans"
    );
    initializeWorkerBanSystem();
    await seedWorkerBanTypes();
  }
  logger.info("Worker-ban system initialized", { source: "startup" });

  // Initialize dashboard plugin system (registration + legacy migrations)
  await initializeDashboardPluginSystem();
  logger.info("Dashboard plugin system initialized", { source: "startup" });

  // Initialize client-injection plugin system (registration + adapter)
  await initializeClientInjectionPluginSystem();
  logger.info("Client-injection plugin system initialized", { source: "startup" });

  // Initialize event-notifier plugin system (registration + adapter)
  initializeEventNotifierPluginSystem();
  logger.info("Event-notifier plugin system initialized", { source: "startup" });

  // Initialize quicksearch plugin system (registration + adapter). No seeding:
  // a quicksearch config's roles are its access decision, so an administrator
  // has to create one before anyone gets a search box.
  initializeQuicksearchPluginSystem();
  logger.info("Quicksearch plugin system initialized", { source: "startup" });

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
  const { initializeWebServiceSystem } = await import("./plugins/web-service");
  registerChargePluginKind();
  registerTrustEligibilityKind();
  registerPaymentGatewayPluginKind();
  initializeWebServiceSystem();
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
    const { migrateNotifierTemplateTokens } = await import(
      "./plugins/event-notifier/template-token-migrations"
    );
    await backfillEventNotifierSubsidiaries();
    // Custom templates are stored verbatim and rendered verbatim, so a
    // renamed token root has to be rewritten in the stored data too.
    await migrateNotifierTemplateTokens();
    initializeEventNotifierDispatcher();
  }
  logger.info("Event-notifier dispatcher initialized", { source: "startup" });
  // Migrate the legacy global `stripe_payment_methods` variable onto each
  // gateway config's own `data.paymentTypes`, then retire the global.
  await backfillPaymentTypesFromGlobal();
  logger.info("Payment types migrated off legacy global variable", { source: "startup" });

  // Initialize worker ban notifications
  initWorkerBanNotifications();
  logger.info("Worker ban notifications initialized", { source: "startup" });

  // Initialize dispatch notifications
  initDispatchNotifications();
  logger.info("Dispatch notifications initialized", { source: "startup" });

  // Initialize automatic WMB rescans on worker data changes
  initWmbAutoRescan();
  logger.info("WMB auto-rescan initialized", { source: "startup" });

  // Initialize automatic COBRA case creation/closing (BAO component)
  initBaoCobraAutoCase();
  logger.info("BAO COBRA auto-case initialized", { source: "startup" });

  // Initialize DP one-month-ahead rescans on DP payments / election changes
  initBaoDpAutoRescan();
  logger.info("BAO DP auto-rescan initialized", { source: "startup" });

  // Reconcile granted Disability Credit hours downward as employer reporting arrives
  initDcGrantReconciliation();
  logger.info("BAO DC grant reconciliation initialized", { source: "startup" });

  // Register charge plugin event listeners.
  // WMB charges are fully event-driven: trust.wmb storage emits WMB_SAVED and
  // this listener runs the WMB charge plugins. Only the WMB listener is enabled
  // here — HOURS/PAYMENT/PARTICIPANT/CRON charge plugins are still invoked
  // directly from their own write paths, so registering the full
  // registerChargePluginListeners() would double-charge them.
  registerWmbChargePluginListener();

  // COBRA election-saved fast path: bill (or reverse) a worker's COBRA
  // premiums immediately when a COBRA election is saved, instead of waiting
  // for the nightly COBRA billing cron. Idempotent alongside the cron.
  registerCobraElectionChargeListener();

  // Register cron plugins (kind + adapter + self-registering plugin imports)
  initializeCronPluginSystem();
  logger.info("Cron plugins registered", { source: "startup" });

  // Register denorm plugins (kind + adapter + self-registering plugin imports)
  initializeDenormPluginSystem();
  logger.info("Denorm plugins registered", { source: "startup" });

  // Register worker-list plugins (kind + adapter + self-registering plugin imports)
  {
    const { initializeWorkerListPluginSystem } = await import("./plugins/worker-list");
    initializeWorkerListPluginSystem();
  }
  logger.info("Worker-list plugins registered", { source: "startup" });

  // Register data-retention plugins (kind + adapter + self-registering plugin imports)
  initializeDataRetentionPluginSystem();
  logger.info("Data-retention plugins registered", { source: "startup" });

  // Register system-status plugins (kind + self-registering plugin imports;
  // no config adapter — results are in-memory only)
  initializeSystemStatusPluginSystem();
  logger.info("System status plugins registered", { source: "startup" });

  // Register wizards as the sixth plugin kind (self-registering plugin imports)
  initializeTrustProviderEdiSystem();
  logger.info("Trust provider EDI system initialized", { source: "startup" });

  initializeWizardPluginSystem();
  logger.info("Wizard plugins registered", { source: "startup" });

  // Register menu plugins (pluggable main navigation)
  initializeMenuPluginSystem();
  logger.info("Menu plugins registered", { source: "startup" });

  // Register token plugins (chained template tokens; kind + self-registering
  // plugin imports, no config adapter)
  initializeTokenPluginSystem();
  logger.info("Token plugins registered", { source: "startup" });

  // Register flood events
  registerFloodEvents();
  logger.info("Flood events registered", { source: "startup" });

  // Load custom flood configurations from variables
  await loadFloodConfigFromVariables();
  logger.info("Flood configs loaded from variables", { source: "startup" });

  // Seed singleton plugin configs (e.g. cron jobs) that have no config row yet
  await bootstrapSingletonPluginConfigs();
  logger.info("Singleton plugin configs bootstrapped", { source: "startup" });

  // Guarantee the admin account described by LOCAL_AUTH_EMAIL /
  // LOCAL_AUTH_PASSWORD_HASH exists, is active, can administer and carries
  // that password (no-op when either is unset). Must run after migrations and
  // before auth setup so the credential is usable on the very first login.
  {
    const { ensureLocalAdminAccount } = await import("./auth/local-seed");
    await ensureLocalAdminAccount();
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

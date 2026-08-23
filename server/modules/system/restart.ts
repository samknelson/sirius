import type { Express } from "express";
import type { Server } from "node:http";
import { requireAccess } from "../../services/access-policy-evaluator";
import { storage } from "../../storage";
import { allowInMaintenanceMode } from "../../storage/maintenance";
import { getRequestContext } from "../../middleware/request-context";
import { logger } from "../../logger";
import { getBootIdentity } from "../../services/boot-identity";
import { getContainerFacts } from "../../services/container-facts";
import {
  buildRestartPrediction,
  checkRestartConfirmation,
  shutdownAndExit,
  RESTART_CONFIRM_PHRASE,
} from "../../services/restart-control";
import {
  listReloadableSubsystems,
  listRestartOnlySubsystems,
  runReloads,
} from "../../services/reload-registry";
import {
  hasRestartBaseline,
  listPendingRestartVariables,
} from "../../services/env-restart-pending";

/**
 * Admin endpoints backing the Restart & Reload page (Task #1258).
 *
 *   GET  /api/admin/restart/info    everything the page renders except the
 *                                   Container Information plugin's own
 *                                   output, which it fetches from the
 *                                   single-entry system-status endpoints.
 *   POST /api/admin/restart/reload  run reloadable subsystems, all or some.
 *   POST /api/admin/restart         shut down and exit.
 *
 * Both mutating actions write an audit entry BEFORE acting, wrapped in
 * `allowInMaintenanceMode` — maintenance mode is exactly when an operator is
 * most likely to need them, and a failed audit write must not be what stops
 * a restart. The write goes straight through the logs storage rather than the
 * winston transport so it is awaited: the restart handler is about to end the
 * process, and a fire-and-forget log would race the exit.
 */

/** Record an audit entry visible in the admin log viewer, with the actor. */
async function audit(
  operation: "reload" | "restart",
  description: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const context = getRequestContext();
  await allowInMaintenanceMode(() =>
    storage.logs.create({
      level: "info",
      message: `Storage operation: system.${operation}`,
      source: "storage",
      module: "system",
      operation,
      description,
      userId: context?.userId ?? null,
      userEmail: context?.userEmail ?? null,
      ipAddress: context?.ipAddress ?? null,
      meta,
    }),
  );
}

export function registerRestartRoutes(app: Express, server?: Server) {
  // Everything the page needs to render itself, in one call.
  app.get("/api/admin/restart/info", requireAccess("admin"), async (_req, res) => {
    try {
      const facts = await getContainerFacts();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        boot: getBootIdentity(),
        // The structured facts, NOT the status plugin's rendered strings.
        // The prediction below is computed from these.
        container: facts,
        prediction: buildRestartPrediction(facts),
        confirmPhrase: RESTART_CONFIRM_PHRASE,
        reloadable: listReloadableSubsystems().map((entry) => ({
          id: entry.id,
          label: entry.label,
          reReads: entry.reReads,
          makesLive: entry.makesLive,
        })),
        restartOnly: listRestartOnlySubsystems(),
        pendingRestartVariables: listPendingRestartVariables(),
        // False when this process never reached the baseline step, so the
        // page can say "unknown" instead of implying "nothing is pending".
        pendingRestartKnown: hasRestartBaseline(),
      });
    } catch (error) {
      logger.error("Failed to assemble restart page info", {
        source: "restart",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to load restart information" });
    }
  });

  app.post("/api/admin/restart/reload", requireAccess("admin"), async (req, res) => {
    try {
      const rawIds = (req.body ?? {}).ids;
      let ids: string[] | undefined;
      if (rawIds !== undefined) {
        if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== "string")) {
          res.status(400).json({ message: "ids must be an array of subsystem ids" });
          return;
        }
        const known = new Set(listReloadableSubsystems().map((entry) => entry.id));
        const unknown = (rawIds as string[]).filter((id) => !known.has(id));
        if (unknown.length > 0) {
          res
            .status(400)
            .json({ message: `Unknown reloadable subsystem(s): ${unknown.join(", ")}` });
          return;
        }
        ids = rawIds as string[];
      }

      await audit(
        "reload",
        `Reloaded configuration: ${ids ? ids.join(", ") : "all subsystems"}`,
        { subsystems: ids ?? "all" },
      );

      const results = await runReloads(ids);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        results,
        // A reload can change the effective value of restart-only variables
        // (the override map is one of the reloadable subsystems), so the page
        // gets a fresh list rather than a stale one.
        pendingRestartVariables: listPendingRestartVariables(),
      });
    } catch (error) {
      logger.error("Configuration reload failed", {
        source: "restart",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to reload configuration" });
    }
  });

  app.post("/api/admin/restart", requireAccess("admin"), async (req, res) => {
    const { bootId } = getBootIdentity();
    try {
      const facts = await getContainerFacts();

      // The typed confirmation is enforced HERE, not in the page. Whenever
      // supervision cannot be established, a restart is a possibly one-way
      // action and must be acknowledged — by a browser, a script, or anything
      // else. Checked before the audit entry and before anything is closed,
      // so a refused request changes nothing at all.
      const confirmation = checkRestartConfirmation(facts, (req.body ?? {}).confirm);
      if (!confirmation.ok) {
        res.status(400).json({ message: confirmation.message });
        return;
      }

      await audit(
        "restart",
        `Restarted the application (${facts.platformLabel}, supervised: ${
          facts.supervised === null ? "unknown" : facts.supervised ? "yes" : "no"
        })`,
        {
          bootId,
          platform: facts.platform,
          supervised: facts.supervised,
          isPid1: facts.isPid1,
        },
      );
    } catch (error) {
      // The audit write is the one thing we insist on before acting. If it
      // cannot be recorded, refuse: an unlogged restart of a production site
      // is worse than no restart.
      logger.error("Refusing to restart — the audit entry could not be recorded", {
        source: "restart",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Could not record the audit entry; restart aborted" });
      return;
    }

    // Answer BEFORE exiting, so the page knows which process it is replacing
    // and can start polling. The shutdown only begins once the response has
    // actually been flushed to the client.
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, bootId });

    const begin = () => {
      void shutdownAndExit(server);
    };
    let started = false;
    const once = () => {
      if (started) return;
      started = true;
      begin();
    };
    res.on("finish", once);
    // Belt and braces: if the response never reports finished (a client that
    // vanished mid-write), exit anyway rather than leaving the operator
    // watching a page that will never change.
    const fallback = setTimeout(once, 2_000);
    fallback.unref?.();
  });
}

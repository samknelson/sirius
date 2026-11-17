import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import { z } from "zod";
import { sendIfMaintenanceRefusal } from "../../../../services/maintenance-flag";
import { wcRequest } from "../../../../services/webclient";
import { WcVendorError } from "../../../../plugins/wc-vendors/errors";
import {
  T631_ACTIONS,
  T631_PLUGIN_ID,
} from "../../../../plugins/wc-vendors/plugins/sitespecific-t631";
import type {
  T631Action,
  T631FetchResult,
} from "../../../../plugins/wc-vendors/plugins/sitespecific-t631";

export type { T631Action, T631FetchResult };

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const VALID_ACTIONS = T631_ACTIONS;

/**
 * Ask the remote T631 service for one action, over the site's T631 connection.
 *
 * A thin adapter over the framework, kept because every caller — four
 * scheduled jobs, the status check and the two admin routes below — names an
 * action and nothing else. They have never chosen a connection, so naming the
 * plugin leaves the choice to the single place that decides what a default is,
 * and this unwraps the framework's uniform result into the diagnostics shape
 * those callers read.
 *
 * The result contract is the plugin's and is unchanged: a remote or network
 * condition comes back as a result the diagnostics page can show, never as a
 * throw. What throws is everything that stopped the request before T631 was
 * asked — no connection, an ambiguous one, a missing or malformed credential,
 * and the maintenance refusal, which is deliberately left to propagate so a
 * caller reports it as the refusal it is rather than as a broken remote system.
 */
export async function t631Fetch(action: T631Action): Promise<T631FetchResult> {
  const result = await wcRequest({
    vendor: { pluginId: T631_PLUGIN_ID },
    operation: action,
    args: undefined as never,
  });
  if (result.outcome === "success") return result.value as T631FetchResult;
  // The plugin's own refusal (a misconfigured credential), unchanged, so the
  // "not configured" test below still recognises it.
  if (result.cause !== undefined) throw result.cause;
  throw new WcVendorError(503, result.error ?? "T631 was not asked.");
}

/**
 * True when the request never reached T631 because the connection itself is
 * unusable — absent, ambiguous, incomplete, or naming a credential that is
 * missing or malformed. Callers that want to say "not configured" rather than
 * "the remote service is broken" ask this; the distinction matters because the
 * two send an operator to completely different places.
 */
export function isT631ConfigurationError(error: unknown): error is WcVendorError {
  return error instanceof WcVendorError;
}

const fetchRequestSchema = z.object({
  action: z.enum(VALID_ACTIONS),
});

const syncWorkersRequestSchema = z.object({
  dryRun: z.boolean().default(true),
});

export function registerT631ClientFetchRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const edlsComponent = requireComponent("edls");
  const t631Component = requireComponent("sitespecific.t631.client");
  const noStore: AuthMiddleware = (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
    next();
  };
  for (const path of [
    "/api/sitespecific/t631/client/sync-workers/runs",
    "/api/sitespecific/t631/client/sync-workers/runs/:runId",
  ]) {
    app.get(path, noStore, requireAuth, requirePermission("admin"), edlsComponent, t631Component,
      async (req, res) => {
        try {
          const { readT631Run, publicT631Run } = await import("../../../../services/t631-sync-runs");
          const run = await readT631Run(req.params.runId);
          if (req.params.runId && !run) return res.status(404).json({ message: "T631 run not found" });
          res.json(run ? publicT631Run(run) : null);
        } catch {
          res.status(503).json({ message: "Sync status is temporarily unavailable. This does not mean the sync failed." });
        }
      });
  }

  app.post(
    "/api/sitespecific/t631/client/fetch",
    requireAuth,
    requirePermission("admin"),
    edlsComponent,
    t631Component,
    async (req: Request, res: Response) => {
      try {
        const parsed = fetchRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(", ")}`,
            validActions: [...VALID_ACTIONS],
          });
        }

        const { action } = parsed.data;
        const result = await t631Fetch(action);

        res.json(result);
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        // A connection that is absent, ambiguous or missing its credential is
        // not a server fault, and each carries the status that says which.
        if (isT631ConfigurationError(error)) {
          return res.status(error.status).json({ message: error.message });
        }
        const message = error instanceof Error ? error.message : "Failed to execute T631 fetch";
        res.status(500).json({ message });
      }
    }
  );

  app.post(
    "/api/sitespecific/t631/client/sync-workers",
    noStore,
    requireAuth,
    requirePermission("admin"),
    edlsComponent,
    t631Component,
    async (req: Request, res: Response) => {
      try {
        const parsed = syncWorkersRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({
            message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        const { dryRun } = parsed.data;

        const { getEffectiveUser } = await import("../../../masquerade");
        const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
        if (!dbUser) return res.status(401).json({ message: "User not found" });
        const { startT631Run } = await import("../../../../services/t631-sync-runs");
        const { run, duplicate } = await startT631Run(dryRun, dbUser.id);
        res.status(duplicate ? 409 : 202).json({ runId: run.id, duplicate });
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (isT631ConfigurationError(error)) {
          return res.status(error.status).json({ message: error.message });
        }
        const { T631RunRefusal } = await import("../../../../services/t631-sync-runs");
        if (error instanceof T631RunRefusal) return res.status(error.status).json({ message: error.message });
        res.status(500).json({ message: "Could not confirm the sync start. Check status before trying again." });
      }
    }
  );
}

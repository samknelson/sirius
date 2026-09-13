import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import { z } from "zod";
import { sendIfMaintenanceRefusal } from "../../../../services/maintenance-flag";
import { resolveDefaultWcVendor, wcVendorRequest } from "../../../../services/webclient/wc-vendor-context";
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
 * A thin adapter over the vendor plugin, kept because every caller — four
 * scheduled jobs, the status check and the two admin routes below — names an
 * action and nothing else. They have never chosen a connection, so this
 * resolves the default one for them, in the single place that decides what a
 * default is.
 *
 * The result contract is the plugin's and is unchanged: a remote or network
 * condition comes back as a result the diagnostics page can show, never as a
 * throw. What throws is everything that stopped the request before T631 was
 * asked — no connection, an ambiguous one, a missing or malformed credential,
 * and the maintenance refusal, which is deliberately left to propagate so a
 * caller reports it as the refusal it is rather than as a broken remote system.
 */
export async function t631Fetch(action: T631Action): Promise<T631FetchResult> {
  const resolved = await resolveDefaultWcVendor(T631_PLUGIN_ID);
  return wcVendorRequest(resolved, action, undefined as never);
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

        const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
        if (!fetchResult.success) {
          return res.status(502).json({
            message: `T631 fetch failed: ${fetchResult.error || "Unknown error"}`,
          });
        }
        const responseBody = fetchResult.data;
        if (!responseBody || typeof responseBody !== "object") {
          return res.status(502).json({ message: "T631 fetch returned empty or non-object response body" });
        }
        const typed = responseBody as { success?: boolean; data?: unknown };
        if (typed.success !== true) {
          return res.status(502).json({ message: "T631 response indicates failure (success !== true)" });
        }
        if (!typed.data || typeof typed.data !== "object") {
          return res.status(502).json({ message: "T631 response missing 'data' field or data is not an object" });
        }

        const { syncWorkerEins } = await import("./sync-workers");
        const syncResult = await syncWorkerEins(
          responseBody as Parameters<typeof syncWorkerEins>[0],
          dryRun,
        );

        res.json({ dryRun, ...syncResult });
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (isT631ConfigurationError(error)) {
          return res.status(error.status).json({ message: error.message });
        }
        const message = error instanceof Error ? error.message : "Failed to sync T631 worker EINs";
        res.status(500).json({ message });
      }
    }
  );
}

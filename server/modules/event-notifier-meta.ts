import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Admin-only metadata endpoints backing the event-notifier admin UI. Currently
 * exposes the staff/admin user list the "staff-recipients" config field renders
 * a picker from (used by staff-mode notifiers such as `trust-wmb-scan`).
 */
export function registerEventNotifierMetaRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/event-notifier/staff-users",
    requireAuth,
    requireAccess("admin"),
    async (_req, res) => {
      try {
        const users = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
        const formatted = users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email,
        }));
        res.json(formatted);
      } catch (error: any) {
        console.error("Error fetching staff users:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to fetch staff users" });
      }
    }
  );

  /**
   * The two things a notifier's template editor needs that are the
   * NOTIFIER'S OWN — one route each, because they are two answers to
   * two questions and only one of them is about previewing.
   *
   * What may be WRITTEN is neither of them: the token graph for this
   * notifier's roots is the same graph every other surface gets, and
   * the editor reads it from /api/token-studio/graph for this
   * notifier's token context.
   *
   * Both are gated like the rest of the notifier config surface, which
   * is also what that context declares.
   */
  type LoadedNotifier =
    | { ok: true; plugin: any; configData: unknown }
    | { ok: false; status: number; message: string };

  /**
   * The notifier named in the path, plus the config as it stands on the
   * admin's screen.
   *
   * Both answers below vary with the config being edited — the defaults
   * because a notifier's fallback text can depend on its other settings
   * (the T631 link target varies with recipientKind), the seeds because
   * which recent events count as this notifier's depends on the same
   * settings — so the editor passes it as ?config=<json>. Malformed
   * JSON is read as "no config stated" rather than refused: the editor
   * is mid-edit, and a generic answer beats a broken card.
   */
  async function loadNotifier(req: Request): Promise<LoadedNotifier> {
    const { eventNotifierRegistry } = await import(
      "../plugins/event-notifier/registry"
    );
    const plugin = eventNotifierRegistry.get(req.params.pluginId);
    if (!plugin?.tokenTemplates) {
      return {
        ok: false,
        status: 404,
        message: "Notifier not found or not token-templated",
      };
    }
    const { isPluginComponentEnabledSync } = await import("../plugins/_core");
    if (!isPluginComponentEnabledSync(plugin)) {
      return { ok: false, status: 404, message: "Notifier component is disabled" };
    }
    let configData: unknown;
    if (typeof req.query.config === "string") {
      try {
        configData = JSON.parse(req.query.config);
      } catch {
        configData = undefined;
      }
    }
    return { ok: true, plugin, configData };
  }

  /**
   * THE NOTIFIER'S DEFAULT TEMPLATES for the config on screen: the text
   * dispatch would fall back to for every field the admin has not
   * overridden. The editor shows them as the effective text and reverts
   * to them, so they are the notifier's own statement and nobody
   * else's.
   */
  app.get(
    "/api/event-notifier/default-templates/:pluginId",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const loaded = await loadNotifier(req);
        if (!loaded.ok) {
          return res.status(loaded.status).json({ message: loaded.message });
        }
        res.json(loaded.plugin.tokenTemplates.defaultTemplates(loaded.configData));
      } catch (error: any) {
        res.status(500).json({
          message: error.message || "Failed to load the notifier's default templates",
        });
      }
    }
  );

  /**
   * WHAT THIS NOTIFIER MAY BE PREVIEWED AGAINST.
   *
   * A notifier config holds no particular record — it describes events
   * that have not happened yet — so the records it puts forward are the
   * ones its RECENT events were about: the notifier's own root builders
   * replayed over the event bus's in-memory buffer, as ids the kinds
   * load and gate fresh. A root the replay found nothing for is
   * previewed as a sample persona, with the reason said where the
   * picker would be.
   */
  app.get(
    "/api/event-notifier/preview-seeds/:pluginId",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const loaded = await loadNotifier(req);
        if (!loaded.ok) {
          return res.status(loaded.status).json({ message: loaded.message });
        }
        const { plugin, configData } = loaded;
        const { tokenContextRootNames } = await import(
          "../plugins/tokens/contexts"
        );
        const { notifierTokenContextId } = await import(
          "@shared/token-contexts"
        );
        const { buildPreviewSeeds } = await import(
          "../plugins/tokens/preview-seeds"
        );
        const { buildNotifierStudioRecords, NOTIFIER_STUDIO_SEED_LIMIT } =
          await import("../plugins/event-notifier/studio-records");
        // The one list this notifier's whole editor is built from: this
        // notifier's token context — its declared record roots, the
        // event envelope and the recipient contact. The editor reads the
        // same context from the `token-contexts` catalog and its config
        // validation accepts tokens against it too, so a root seeded
        // here is one the author can actually write about.
        const rootNames = tokenContextRootNames(
          notifierTokenContextId(plugin.id),
        );
        res.json(
          await buildPreviewSeeds(
            { storage, req },
            {
              rootNames,
              ...(await buildNotifierStudioRecords(plugin, configData)),
              limit: NOTIFIER_STUDIO_SEED_LIMIT,
            },
          ),
        );
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load preview seeds" });
      }
    }
  );

  // Notifier template previews go through the single Template Studio
  // preview route (POST /api/template-studio/preview, surface
  // "event-notifier"); there is no notifier-specific preview endpoint.
}
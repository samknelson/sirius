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
    async (req, res) => {
      try {
        const roleId = typeof req.query.roleId === "string" ? req.query.roleId.trim() : "";
        const idsParam = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
        let users;
        if (idsParam) {
          // Resolve already-saved selections for display: returned regardless
          // of current role membership or active status so a stale selection
          // stays visible and removable. Save-time validation (staff/admin
          // membership) still gates what can be ADDED.
          const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
          users = await storage.users.getUsersByIds(ids);
        } else if (roleId) {
          // Role-first candidate list: active staff/admin holders of the role.
          users = await storage.users.getUsersWithAnyPermissionInRole(roleId, [
            "staff",
            "admin",
          ]);
        } else {
          users = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
        }
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
   * Token catalog for a token-templated notifier's template editor:
   * the segment graph with the notifier's event entity kind substituted
   * for the dynamic `event` root, the schema-derived field catalog, and
   * the notifier's default templates (shown as placeholders / reset
   * targets). Gated like the rest of the notifier config surface.
   */
  app.get(
    "/api/event-notifier/token-catalog/:pluginId",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { eventNotifierRegistry } = await import(
          "../plugins/event-notifier/registry"
        );
        const plugin = eventNotifierRegistry.get(req.params.pluginId);
        if (!plugin?.tokenTemplates) {
          return res
            .status(404)
            .json({ message: "Notifier not found or not token-templated" });
        }
        const { isPluginComponentEnabledSync } = await import("../plugins/_core");
        if (!isPluginComponentEnabledSync(plugin)) {
          return res.status(404).json({ message: "Notifier component is disabled" });
        }
        const {
          buildSegmentSpecsForRoots,
          buildFieldCatalog,
          buildTokenCatalogForRoots,
          listTokenTreeRoots,
        } = await import("../plugins/tokens");
        const { notifierTokenRootNames } = await import(
          "../plugins/event-notifier/token-roots"
        );
        const { buildTokenStudioContext } = await import(
          "../plugins/tokens/studio-context"
        );
        const { buildNotifierStudioRecords, NOTIFIER_STUDIO_SEED_LIMIT } =
          await import("../plugins/event-notifier/studio-records");
        // The one list this notifier's whole editor is built from: its
        // declared record roots, the event envelope and the recipient
        // contact (see notifierTokenRootNames). It is also the list its
        // config validation accepts tokens against, so the editor cannot
        // offer a token that save then rejects.
        const rootNames = notifierTokenRootNames(plugin.tokenTemplates.roots);
        // Defaults may depend on the config's other fields (e.g. the T631
        // link target varies with recipientKind); the editor passes the
        // relevant subset as ?config=<json> so placeholders match what
        // dispatch would actually fall back to. Malformed → generic.
        let configData: unknown;
        if (typeof req.query.config === "string") {
          try {
            configData = JSON.parse(req.query.config);
          } catch {
            configData = undefined;
          }
        }
        res.json({
          rootNames,
          segments: buildSegmentSpecsForRoots(rootNames),
          fields: buildFieldCatalog(),
          defaults: plugin.tokenTemplates.defaultTemplates(configData),
          // Picker entries for the Template Studio token browser (the
          // notifier's named record roots included).
          tokens: buildTokenCatalogForRoots(rootNames),
          // Lazy tree roots, so the picker can browse deep chains
          // without the flat catalog enumerating them all.
          treeRoots: listTokenTreeRoots(rootNames),
          // What the studio may preview each of those roots as. A
          // notifier config holds no particular record — it describes
          // events that have not happened yet — so the records it puts
          // forward are the ones its RECENT events were about: the
          // notifier's own root builders replayed over the event bus's
          // in-memory buffer, as ids the kinds load and gate fresh. A
          // root the replay found nothing for is previewed as a sample
          // persona, with the reason said where the picker would be.
          studioContext: await buildTokenStudioContext(
            { storage, req },
            {
              rootNames,
              ...(await buildNotifierStudioRecords(plugin, configData)),
              limit: NOTIFIER_STUDIO_SEED_LIMIT,
            },
          ),
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    }
  );

  // Notifier template previews go through the single Template Studio
  // preview route (POST /api/template-studio/preview, surface
  // "event-notifier"); there is no notifier-specific preview endpoint.
}
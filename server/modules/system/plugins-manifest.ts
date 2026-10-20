import type { Express, Request, Response, NextFunction } from "express";
import { getPluginKind, enforceKindGating } from "../../plugins/_core";
import { getPluginConfigAdapter } from "../../plugins/_core/config-adapter";
import { pluginDefinitionEntry } from "../../plugins/_core/definition-catalog";
import type { PluginDefinitionCatalog } from "@shared/plugin-definition-catalog";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Unified plugin manifest endpoint. Replaces the four legacy URLs:
 *   /api/dashboard-plugins/manifest
 *   /api/dispatch-eligibility-plugins
 *   /api/charge-plugins
 *   /api/eligibility-plugins
 *
 * Authorization model:
 * - The route itself always requires authentication.
 * - Each kind opts in to its own component + access-policy gate at
 *   registration time (`requiredComponent`, `requiredPolicy`). The
 *   route enforces them before listing, matching the legacy
 *   `requireComponent + requireAccess` middleware stack each
 *   per-kind endpoint used to ship with.
 * - Per-plugin `requiredPolicy` and `requiredComponent` still apply
 *   inside `registry.listVisibleTo(req)`.
 *
 * All four legacy endpoints are removed in Task #208; every client +
 * server caller has been ported to this endpoint.
 */
export function registerPluginsManifestRoutes(app: Express, requireAuth: AuthMiddleware) {
  app.get("/api/plugins/:kind/catalog", requireAuth, async (req, res) => {
    // Definitions can include operational defaults. Match the catalog/admin
    // surfaces, then apply the kind's AND each plugin's own visibility gates.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    try {
      const adminGate = await enforceKindGating({ requiredPolicy: "admin" }, req);
      if (!adminGate.ok) {
        return res.status(adminGate.status).json({ message: adminGate.message });
      }
      const registration = getPluginKind(req.params.kind);
      if (!registration) return res.status(404).json({ message: "Unknown plugin kind" });
      const gate = await enforceKindGating(registration, req);
      if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

      const plugins = await registration.registry.listVisibleTo(req);
      const entries = plugins
        .filter((plugin) => !registration.registry.getMetadata(plugin).hidden)
        .map((plugin) => pluginDefinitionEntry(
          registration.registry.getMetadata(plugin),
          registration.registry.toManifestEntry(plugin),
        ))
        .sort((a, b) => a.name.localeCompare(b.name));
      const catalog: PluginDefinitionCatalog = {
        kind: registration.kind,
        label: registration.label ?? registration.kind.split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
        description: registration.description,
        ...(getPluginConfigAdapter(registration.kind)
          ? { configurationPath: `/admin/plugin-configs/${encodeURIComponent(registration.kind)}` }
          : {}),
        entries,
      };
      // Deliberately do not call decorateEntries: it adds runtime/configured
      // values, whereas this view describes only what the code declares.
      return res.json({ catalog });
    } catch (error) {
      console.error("Failed to fetch plugin definition catalog:", error);
      return res.status(500).json({ message: "Failed to fetch plugin definitions" });
    }
  });

  app.get("/api/plugins/:kind/manifest", requireAuth, async (req, res) => {
    try {
      const { kind } = req.params;
      const registration = getPluginKind(kind);
      if (!registration) {
        res.status(404).json({ message: `Unknown plugin kind: ${kind}` });
        return;
      }

      const kindGate = await enforceKindGating(
        {
          requiredComponent: registration.requiredComponent,
          requiredPolicy: registration.requiredPolicy,
        },
        req,
      );
      if (!kindGate.ok) {
        res.status(kindGate.status).json({ message: kindGate.message });
        return;
      }

      const visible = await registration.registry.listVisibleTo(req);
      // Hidden filtering must read base metadata (single source of truth)
      // — not the manifest-entry shape, which is per-kind and may omit it.
      const notHidden = visible.filter((p) => !registration.registry.getMetadata(p).hidden);
      let entries = notHidden.map((p) => registration.registry.toManifestEntry(p));

      const sort = registration.sortEntries ?? ((a: any, b: any) => String(a?.id).localeCompare(String(b?.id)));
      entries = entries.slice().sort(sort);

      if (registration.decorateEntries) {
        entries = await registration.decorateEntries(entries, req);
      }

      // Plugin availability changes with component toggles / settings.
      // Avoid stale results in any caller that bypasses TanStack Query.
      res.setHeader("Cache-Control", "no-store");
      res.json(entries);
    } catch (error) {
      console.error("Failed to fetch plugin manifest:", error);
      res.status(500).json({ message: "Failed to fetch plugin manifest" });
    }
  });

}

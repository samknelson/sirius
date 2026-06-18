import type { Express, Request, Response, NextFunction } from "express";
import { getPluginKind, enforceKindGating, listPluginConfigAdapters } from "../plugins/_core";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/** Derive a human-readable label from a kind id (e.g. "trust-eligibility" → "Trust Eligibility"). */
function prettifyKind(kind: string): string {
  return kind
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

  // Index of configurable plugin kinds. Drives the admin navigation page
  // at /admin/plugin-configs so the kind list is never duplicated in the
  // client. A kind is "configurable" when it has a registered config
  // adapter (`client-injection` has none and is therefore excluded). Each
  // kind is filtered by the same component + access-policy gate the
  // manifest endpoint applies, so a caller only sees kinds they may
  // configure.
  app.get("/api/plugins/kinds", requireAuth, async (req, res) => {
    try {
      const kinds: { kind: string; label: string; description?: string }[] = [];
      for (const kind of listPluginConfigAdapters()) {
        const registration = getPluginKind(kind);
        // A config adapter without a kind registration can't be gated
        // safely, so skip it rather than expose an ungated link.
        if (!registration) continue;

        const kindGate = await enforceKindGating(
          {
            requiredComponent: registration.requiredComponent,
            requiredPolicy: registration.requiredPolicy,
          },
          req,
        );
        if (!kindGate.ok) continue;

        kinds.push({
          kind,
          label: registration.label ?? prettifyKind(kind),
          description: registration.description,
        });
      }

      kinds.sort((a, b) => a.label.localeCompare(b.label));

      res.setHeader("Cache-Control", "no-store");
      res.json(kinds);
    } catch (error) {
      console.error("Failed to list plugin kinds:", error);
      res.status(500).json({ message: "Failed to list plugin kinds" });
    }
  });
}

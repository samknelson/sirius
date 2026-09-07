import type { Express, Request, Response } from "express";
import {
  allCatalogPermissionNames,
  catalogPermissionNames,
  getCatalogVersion,
  listCatalogsFor,
  readCatalog,
} from "@shared/catalog";
import { catalogViewerFor } from "../services/catalog-viewer";
import { logger } from "../logger";

/**
 * One address to read any catalog.
 *
 * Every list here is code-supplied, so these two endpoints only read. There is
 * no write verb to add later: a catalog cannot be edited over HTTP because it
 * is not stored anywhere to edit.
 *
 * Access is not decided here. Each catalog declares its own audience and the
 * framework decides per request, so adding a catalog never means remembering to
 * come back and gate it — a catalog that declares nothing usable fails closed
 * at declaration time. What this file does decide is how a refusal is spelled
 * as HTTP.
 */

const SERVICE = "catalogs";

/**
 * A refusal, as a status code.
 *
 * An unknown name is 404 and a refused one is 403, which does tell an
 * unauthorized caller that a catalog by that name exists. That is deliberate:
 * catalog ids are code-supplied constants, not anybody's data, and answering
 * both cases identically makes a misspelled id indistinguishable from a
 * permissions problem for the administrator debugging it.
 *
 * A refused *anonymous* request is 401 rather than 403, because signing in is
 * the thing that might actually change the answer.
 */
function refusalStatus(reason: "unknown" | "denied", authenticated: boolean): number {
  if (reason === "unknown") return 404;
  return authenticated ? 403 : 401;
}

/**
 * One address can hand two callers two different payloads, so nothing shared may
 * hold on to it. The body names the tier it represents for the same reason —
 * a client cache that keys on the URL alone would replay a privileged answer.
 */
function markAsPerViewer(res: Response): void {
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Catalog-Version", getCatalogVersion());
}

export function registerCatalogRoutes(app: Express): void {
  // The literal path is registered before the one with a name in it, so
  // `/api/catalogs` can never be captured as a catalog named "catalogs".
  app.get("/api/catalogs", async (req: Request, res: Response) => {
    try {
      // The index reports each catalog at the tier that catalog would serve
      // this viewer, so it needs every permission any catalog names.
      const viewer = await catalogViewerFor(req, allCatalogPermissionNames());
      markAsPerViewer(res);

      res.json({ catalogs: listCatalogsFor(viewer) });
    } catch (error) {
      logger.error("Failed to list catalogs", { service: SERVICE, error });
      res.status(500).json({ message: "Failed to list catalogs" });
    }
  });

  app.get("/api/catalogs/:catalogId", async (req: Request, res: Response) => {
    const catalogId = req.params.catalogId;

    try {
      const viewer = await catalogViewerFor(req, catalogPermissionNames(catalogId));
      const result = readCatalog(catalogId, viewer);

      if (!result.ok) {
        markAsPerViewer(res);
        return res
          .status(refusalStatus(result.reason, viewer.authenticated))
          .json({ message: result.message });
      }

      markAsPerViewer(res);
      // `readCatalog` has already dropped switched-off components' entries and
      // omitted restricted detail this viewer may not see. Nothing further is
      // filtered here, so there is no second, divergent rule to keep in step.
      res.json({ catalog: result.catalog });
    } catch (error) {
      logger.error("Failed to read catalog", { service: SERVICE, catalogId, error });
      res.status(500).json({ message: "Failed to read catalog" });
    }
  });
}

import type { Request } from "express";
import { ANONYMOUS_VIEWER, catalogPermissionNames, type CatalogViewer } from "@shared/catalog";
import { storage } from "../storage";
import { buildContext } from "./access-policy-evaluator";

/**
 * Build a {@link CatalogViewer} for an HTTP request.
 *
 * A catalog viewer answers synchronously — a catalog read happens after the
 * caller has already worked out who is asking — but this codebase resolves
 * permissions with a query. So the permissions are loaded up front and the
 * viewer closes over the answers.
 *
 * Which permissions? The ones the catalog itself names. A route that hardcoded
 * a permission name would keep answering after the declaration changed its
 * mind, and nothing would say so.
 *
 * The user comes from `buildContext`, so a masquerading session is judged as
 * the masqueraded user — the same actor every other surface uses.
 */
export async function catalogViewerFor(
  req: Request,
  permissions: readonly string[],
): Promise<CatalogViewer> {
  const { user } = await buildContext(req);
  if (!user) return ANONYMOUS_VIEWER;

  const asked = new Set(permissions);
  const granted = new Set<string>();

  await Promise.all(
    Array.from(asked).map(async (permission) => {
      if (await storage.users.userHasPermission(user.id, permission)) {
        granted.add(permission);
      }
    }),
  );

  return {
    authenticated: true,
    hasPermission: (permission: string) => {
      // Answering `false` for a permission that was never loaded would silently
      // deny a reader who actually holds it. Say so instead.
      if (!asked.has(permission)) {
        throw new Error(
          `Catalog viewer cannot answer for permission '${permission}': it was ` +
            `built to answer for ${asked.size === 0 ? "none" : Array.from(asked).join(", ")}. ` +
            "Build it from the catalog whose permissions you need.",
        );
      }
      return granted.has(permission);
    },
  };
}

/** A viewer loaded with exactly the permissions one catalog names. */
export function catalogViewerForCatalog(
  req: Request,
  catalogId: string,
): Promise<CatalogViewer> {
  return catalogViewerFor(req, catalogPermissionNames(catalogId));
}

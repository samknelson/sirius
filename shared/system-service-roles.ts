import type { CatalogEntry } from "./catalog";

/**
 * Code-supplied service capabilities. This is intentionally a catalog
 * declaration, not a description of the roles selected for one process.
 */
export const SYSTEM_SERVICE_ROLE_ENTRIES = [
  {
    id: "static",
    name: "Static application",
    description: "Serves the built single-page application and every non-API static asset.",
    detail: {
      routeScope: "Every request outside /api.",
    },
  },
  {
    id: "api-ws",
    name: "Web services API",
    description: "Serves credential-authenticated web service operations under /api/ws.",
    detail: {
      routeScope: "/api/ws and its descendants only.",
    },
  },
  {
    id: "api-user",
    name: "User API",
    description: "Serves the application API outside the web service mount, including catalogs.",
    detail: {
      routeScope: "Every /api request other than /api/ws and its descendants.",
    },
  },
] as const satisfies readonly CatalogEntry[];

export type SystemServiceRole = (typeof SYSTEM_SERVICE_ROLE_ENTRIES)[number]["id"];

/** The unfiltered declaration vocabulary used by early boot validation. */
export function getSystemServiceRoleEntries(): readonly typeof SYSTEM_SERVICE_ROLE_ENTRIES[number][] {
  return SYSTEM_SERVICE_ROLE_ENTRIES;
}

/**
 * The one traffic classification for service-role routing. `/api/ws` is a
 * segment prefix, not a textual prefix, so `/api/wsfoo` remains user API.
 */
export function classifySystemServicePath(path: string): SystemServiceRole {
  if (path === "/api/ws" || path.startsWith("/api/ws/")) return "api-ws";
  if (path === "/api" || path.startsWith("/api/")) return "api-user";
  return "static";
}
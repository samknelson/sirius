import { useQuery } from "@tanstack/react-query";
import type { CatalogAudience } from "@shared/catalog";
import { useAuth } from "@/contexts/AuthContext";

/** How each declared audience reads to an administrator. */
export const AUDIENCE_LABEL: Record<CatalogAudience, string> = {
  "signed-out": "Anyone",
  "signed-in": "Anyone signed in",
  gated: "By permission",
};

/**
 * The cache key for a catalog read.
 *
 * One address returns different payloads to different viewers — a reader with
 * the restricted permission gets detail another reader must not see — so the
 * cached answer belongs to a viewer, not to the URL. Keyed on the URL alone, a
 * privileged response survives in the cache and is handed to whoever holds the
 * page next.
 */
export function catalogQueryKey(viewerId: string, path: string): readonly unknown[] {
  return ["catalogs", viewerId, path];
}

/**
 * Read a catalog address.
 *
 * Deliberately not the shared default fetcher: that one derives the URL from
 * the query key, and this key carries the viewer as well as the path.
 */
export function useCatalogQuery<T>(path: string) {
  const { user } = useAuth();
  const viewerId = user?.id ?? "anonymous";

  return useQuery<T>({
    queryKey: catalogQueryKey(viewerId, path),
    // A catalog answer is a permission decision, and a permission decision must
    // not outlive the screen that asked for it. The shared client caches
    // forever, which would keep a restricted payload usable after the reader
    // lost the permission that earned it — same person, same key, no second
    // trip to the server. Holding nothing once the screen is gone means the
    // next viewing is always answered by the server.
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Request failed (${response.status})`);
      }
      return response.json();
    },
  });
}

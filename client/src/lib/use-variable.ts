import { useQuery } from "@tanstack/react-query";
import type { SystemMode } from "@/lib/system-types";

/**
 * Read a single variable's value via GET /api/variables/by-name/:name.
 *
 * Missing variables (404) resolve to null so callers can apply their own
 * defaults. Access errors (401/403) throw, which also lands callers on
 * their defaults since `data` stays undefined.
 */
export function useVariableValue(
  name: string,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useQuery<unknown>({
    queryKey: ["/api/variables/by-name", name],
    queryFn: async () => {
      const res = await fetch(`/api/variables/by-name/${encodeURIComponent(name)}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}: Failed to fetch variable ${name}`);
      const variable = await res.json();
      return variable?.value ?? null;
    },
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

/** Parse a variable value that may be stored as a JSON string. */
export function parseVariableJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const VALID_MODES: SystemMode[] = ["dev", "test", "live"];

/** Current system mode from the public `system_mode` variable (default "dev"). */
export function useSystemMode(): { mode: SystemMode; isLoading: boolean } {
  const { data, isLoading } = useVariableValue("system_mode");
  const mode =
    typeof data === "string" && VALID_MODES.includes(data as SystemMode)
      ? (data as SystemMode)
      : "dev";
  return { mode, isLoading };
}

/** Site settings assembled from the public site_name / site_title / site_footer variables. */
export function useSiteSettings(): {
  siteName: string;
  siteTitle: string;
  footer: string;
  isLoading: boolean;
} {
  const nameQuery = useVariableValue("site_name");
  const titleQuery = useVariableValue("site_title");
  const footerQuery = useVariableValue("site_footer");

  return {
    siteName: typeof nameQuery.data === "string" && nameQuery.data ? nameQuery.data : "Sirius",
    siteTitle: typeof titleQuery.data === "string" ? titleQuery.data : "",
    footer: typeof footerQuery.data === "string" ? footerQuery.data : "",
    isLoading: nameQuery.isLoading || titleQuery.isLoading || footerQuery.isLoading,
  };
}

/** Invalidate helpers for the write pages (PUT routes are unchanged). */
export const SITE_SETTING_VARIABLE_KEYS = [
  ["/api/variables/by-name", "site_name"],
  ["/api/variables/by-name", "site_title"],
  ["/api/variables/by-name", "site_footer"],
] as const;

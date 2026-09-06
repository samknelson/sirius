import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  configSections,
  getAccessibleSections,
  getAllPoliciesNeeded,
  resolveConfigSections,
  type AccessContext,
  type NavSection,
  type OptionsCatalogEntry,
} from "@/config/navigation-registry";
import { useAuth } from "@/contexts/AuthContext";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

/**
 * The permissions, policies and enabled components the config navigation is
 * filtered by. One implementation, so every surface that offers a config link
 * decides the same way.
 */
export function useNavAccessContext(): AccessContext {
  const { hasPermission } = useAuth();

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const isComponentEnabled = (componentId: string) =>
    componentConfig.find(c => c.componentId === componentId)?.enabled ?? false;

  const policiesNeeded = useMemo(() => getAllPoliciesNeeded(), []);

  const { data: policyResults = {} } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ["/api/access/policies/batch", ...policiesNeeded],
    queryFn: async () => {
      if (policiesNeeded.length === 0) return {};

      const results: Record<string, { allowed: boolean }> = {};
      await Promise.all(
        policiesNeeded.map(async (policy) => {
          try {
            const response = await fetch(`/api/access/policies/${policy}`);
            if (response.ok) {
              const data = await response.json();
              results[policy] = { allowed: data.access?.granted ?? false };
            } else {
              results[policy] = { allowed: false };
            }
          } catch {
            results[policy] = { allowed: false };
          }
        })
      );
      return results;
    },
    staleTime: 30000,
    enabled: policiesNeeded.length > 0,
  });

  return useMemo(
    () => ({ hasPermission, policyResults, isComponentEnabled }),
    [hasPermission, policyResults, componentConfig],
  );
}

/**
 * The options registry's catalog: every dropdown list, with the name it is
 * known by everywhere — including the lists administered on their own page,
 * which carry a `bespokePath`. Shared by the config navigation and the options
 * index so both call the same lists by the same names.
 */
export function useOptionsCatalog() {
  const query = useQuery<OptionsCatalogEntry[]>({
    queryKey: ["/api/options/catalog"],
    staleTime: 300000,
  });

  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * The config navigation with its dynamic sections resolved. Both config
 * surfaces (the sidebar and the Config landing page) go through this, so the
 * two can never disagree about what exists or what it is called.
 *
 * These sections are unfiltered; use `useAccessibleConfigSections` to get the
 * ones this user may see.
 */
export function useConfigNavigation(): {
  sections: NavSection[];
  isLoading: boolean;
  isError: boolean;
} {
  const { entries, isLoading, isError } = useOptionsCatalog();

  const sections = useMemo(
    () =>
      resolveConfigSections(
        { entries, status: isLoading ? "loading" : isError ? "error" : "ready" },
        configSections,
      ),
    [entries, isLoading, isError],
  );

  return { sections, isLoading, isError };
}

/**
 * The config navigation as this user may see it: dynamic sections resolved,
 * then filtered by permission, policy and component. Every surface that offers
 * config links reads this, so none of them can offer a link the others hide —
 * or one the destination will refuse.
 */
export function useAccessibleConfigSections(): {
  sections: NavSection[];
  isLoading: boolean;
  isError: boolean;
} {
  const { sections, isLoading, isError } = useConfigNavigation();
  const accessContext = useNavAccessContext();

  const accessible = useMemo(
    () => getAccessibleSections(accessContext, sections),
    [accessContext, sections],
  );

  return { sections: accessible, isLoading, isError };
}

/**
 * The name the options registry gives one list, for a page that administers
 * that list on its own. Undefined until the catalog answers — a page shows a
 * neutral placeholder rather than a name of its own invention.
 */
export function useOptionsListName(type: string): { name?: string; pluralName?: string } {
  const { entries } = useOptionsCatalog();
  const entry = entries.find(candidate => candidate.type === type);
  return { name: entry?.name, pluralName: entry?.pluralName };
}

/** Every config path this user may follow, across all sections. */
export function useReachableConfigPaths(): { paths: Set<string>; isLoading: boolean; isError: boolean } {
  const { sections, isLoading, isError } = useAccessibleConfigSections();

  const paths = useMemo(
    () =>
      new Set(
        sections.flatMap(section => [
          ...section.items.map(item => item.path),
          ...(section.subsections ?? []).flatMap(sub => sub.items.map(item => item.path)),
        ]),
      ),
    [sections],
  );

  return { paths, isLoading, isError };
}

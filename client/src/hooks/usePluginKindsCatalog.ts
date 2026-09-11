import { useMemo } from "react";
import type { ResolvedCatalog } from "@shared/catalog";
import { PLUGIN_KINDS_CATALOG } from "@shared/catalog-ids";
import { useCatalogQuery } from "@/hooks/useCatalogQuery";
import { toPluginKindSummaries } from "@/plugins/_core";

/** Read the Plugin Kinds catalog through the viewer-scoped catalog cache. */
export function usePluginKindsCatalog(enabled = true) {
  const query = useCatalogQuery<{ catalog: ResolvedCatalog }>(
    `/api/catalogs/${PLUGIN_KINDS_CATALOG}`,
    enabled,
  );
  const kinds = useMemo(
    () => toPluginKindSummaries(query.data?.catalog.entries ?? []),
    [query.data],
  );

  return {
    kinds,
    configurableKinds: kinds.filter((kind) => kind.configurable),
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
}
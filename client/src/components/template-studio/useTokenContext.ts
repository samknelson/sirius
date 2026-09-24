import { useMemo } from "react";
import type { ResolvedCatalog } from "@shared/catalog";
import { TOKEN_CONTEXTS_CATALOG } from "@shared/catalog-ids";
import { findTokenContext, type TokenContextEntry } from "@shared/token-contexts";
import { useCatalogQuery } from "@/hooks/useCatalogQuery";

/**
 * WHAT THE TEMPLATES BEING EDITED ARE ABOUT.
 *
 * Every Template Studio launch names a token CONTEXT — bulk messaging,
 * a compose screen, one notifier — and the roots its tokens may start
 * from come from that context and nowhere else. This is the one place
 * the browser reads them: the shared `token-contexts` catalog, the same
 * declaration the server builds the surface's tokens, tree and
 * save-time validation from.
 *
 * The failure is part of the answer. A context that is not in the
 * catalog is not an empty root list — it is a surface naming something
 * this deployment does not offer (a notifier whose component was
 * switched off, an id that drifted) — and the studio has to be able to
 * say so where it would otherwise show an author an empty token
 * browser.
 */
export interface TokenContextState {
  /** The named context, once it has loaded. */
  context?: TokenContextEntry;
  loading: boolean;
  /** The catalog request's failure, or this context's absence from it. */
  error?: unknown;
  retry: () => void;
  /** The catalog address, for the studio's diagnostics line. */
  url: string;
}

export function useTokenContext(contextId: string): TokenContextState {
  const url = `/api/catalogs/${TOKEN_CONTEXTS_CATALOG}`;
  const { data, isLoading, error, refetch } = useCatalogQuery<{
    catalog: ResolvedCatalog;
  }>(url);

  const context = useMemo(
    () => findTokenContext(data?.catalog.entries, contextId),
    [data, contextId],
  );

  const missing =
    !isLoading && !error && data !== undefined && context === undefined
      ? new Error(
          `This editor is set up for a token context ("${contextId}") that this ` +
            `deployment does not offer, so there are no tokens to write with.`,
        )
      : undefined;

  return {
    ...(context ? { context } : {}),
    loading: isLoading,
    ...(error || missing ? { error: error ?? missing } : {}),
    retry: () => {
      void refetch();
    },
    url,
  };
}

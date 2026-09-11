import { registerCatalog } from "@shared/catalog";
import { TOKEN_CONTEXTS_CATALOG } from "@shared/catalog-ids";
import { tokenContextDetail } from "@shared/token-contexts";
import { listTokenContexts } from "../plugins/tokens/contexts";

/**
 * What each token-editing surface's templates are about, as a shared
 * catalog.
 *
 * The registry this projects (server/plugins/tokens/contexts.ts) is the
 * one statement of a surface's roots; this is how the browser reads it.
 * Every Template Studio launch names a context id and takes its roots
 * from here, which is what retired the root lists the launch sites used
 * to carry: there is no second place for the client's idea of a
 * surface's roots to come from, so there is nothing for the server's to
 * drift away from.
 *
 * Kept out of the registry file for the same reason the terminology and
 * options catalogs are: that module is imported by token surfaces on the
 * boot path and should not pick up a registration side effect on import.
 *
 * `signed-in`, with nothing restricted. A context says which records a
 * surface's templates are written about — the same thing its token
 * browser has always shown its authors — and reaching any of those
 * surfaces is gated by the surface's own route. Entries derive on every
 * read, so a notifier whose component is switched off takes its context
 * with it.
 */

export function registerTokenContextsCatalog(): void {
  registerCatalog({
    id: TOKEN_CONTEXTS_CATALOG,
    label: "Token Contexts",
    description:
      "The token-editing surfaces this deployment offers, each with the " +
      "complete ordered list of roots its templates may be written about.",
    audience: "signed-in",
    entries: () =>
      listTokenContexts().map((context) => ({
        id: context.id,
        name: context.name,
        ...(context.description !== undefined
          ? { description: context.description }
          : {}),
        ...(context.component !== undefined
          ? { component: context.component }
          : {}),
        detail: tokenContextDetail(context),
      })),
  });
}

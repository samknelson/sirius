import type { CatalogDetail, ResolvedCatalogEntry } from "./catalog/types";
import { MEDIUM_NAMES, type MediumName } from "./delivery-fields";
import type { ComposeScopeName } from "./comm-compose";

/**
 * WHAT A TOKEN TEMPLATE IS ABOUT — declared once per surface.
 *
 * Every screen that opens the Template Studio writes tokens against a
 * fixed set of ROOTS: bulk messaging writes about the send it is going
 * to make, a compose screen about the person whose page it is on, a
 * notifier about the record its event was raised for. That set is not a
 * preference and not a client decision — a root the surface has no
 * record for produces a token that validates, previews and then arrives
 * blank.
 *
 * A TOKEN CONTEXT is that set, named. One surface, one id, one ordered
 * root list, published through the shared catalog framework so both
 * halves of the app read the SAME list: the editor offers those roots,
 * the browsable tree walks them, save-time validation accepts tokens
 * rooted in them and the coverage check measures them. A launch site
 * names its context and nothing else; it can no longer carry a root
 * list of its own that the server's list can drift away from.
 *
 * This file is the declaration both halves import. It holds the shape,
 * the catalog detail it travels as, and the ids that are fixed in code
 * on both sides. A notifier's context id is not fixed here: there is one
 * per notifier, so it is derived from the plugin id — see
 * {@link notifierTokenContextId}.
 */

/** One surface's token context. */
export interface TokenContextDeclaration {
  /** Stable id both halves name. */
  id: string;
  /** Human name, as an administrator browsing the catalog reads it. */
  name: string;
  description?: string;
  /**
   * The COMPLETE ordered list of roots this surface's tokens may start
   * from. Order is author-visible: lead with the record the messages
   * are really about. A root that is not here does not exist for these
   * templates.
   */
  rootNames: string[];
  /**
   * The media this surface authors messages on — which of the shared
   * medium field declarations apply to the text written in this
   * context. Derived from whatever the surface already offers, never a
   * second hand-written list of its channels.
   */
  media: MediumName[];
  /**
   * WHO MAY WRITE IN THIS CONTEXT — the access policy id guarding the
   * surface itself (`bulk.edit` for a bulk message, `staff` for a
   * compose screen, `admin` for a notifier's config).
   *
   * Stated here because the token GRAPH — the picker entries, the
   * segment specs, the field index — is the same everywhere and is
   * therefore built once, in one place, for whichever context is named.
   * That one route cannot carry one gate: it is answering for surfaces
   * gated three different ways, so the gate has to travel with the
   * thing being asked about. A context that names none is refused, not
   * waved through: an unstated gate is a wiring mistake, and the only
   * safe reading of it is "nobody".
   *
   * Server-side only. It is deliberately NOT published on the context's
   * catalog entry: what a browser may do is decided by the server on
   * every request, and shipping the policy id would invite a client to
   * decide it instead.
   */
  access: string;
  /** Component that must be enabled for the surface to exist. */
  component?: string;
}

/** A token context as it travels on a catalog entry. */
export interface TokenContextDetail extends CatalogDetail {
  rootNames: string[];
  media: string[];
}

/** The detail payload for one context's catalog entry. */
export function tokenContextDetail(
  declaration: Pick<TokenContextDeclaration, "rootNames" | "media">,
): TokenContextDetail {
  return {
    rootNames: [...declaration.rootNames],
    media: [...declaration.media],
  };
}

/** One context as a reader of the catalog receives it. */
export interface TokenContextEntry {
  id: string;
  name: string;
  description?: string;
  rootNames: string[];
  media: MediumName[];
}

/**
 * Read one context out of a catalog entry.
 *
 * Returns `undefined` for an entry that carries no root list rather than
 * inventing an empty one: a studio with no roots would offer an author
 * nothing and say nothing about why, and "this context is not the shape
 * this reader expects" is a failure its caller has to be able to show.
 */
export function readTokenContext(
  entry: ResolvedCatalogEntry | undefined,
): TokenContextEntry | undefined {
  const detail = entry?.detail as Partial<TokenContextDetail> | undefined;
  if (!entry || !detail) return undefined;
  const { rootNames, media } = detail;
  if (!Array.isArray(rootNames) || rootNames.length === 0) return undefined;
  if (!rootNames.every((name): name is string => typeof name === "string")) {
    return undefined;
  }
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    rootNames: [...rootNames],
    media: (Array.isArray(media) ? media : []).filter(
      (medium): medium is MediumName =>
        (MEDIUM_NAMES as readonly unknown[]).includes(medium),
    ),
  };
}

/** Find one context by id in a catalog's entries. */
export function findTokenContext(
  entries: readonly ResolvedCatalogEntry[] | undefined,
  id: string,
): TokenContextEntry | undefined {
  return readTokenContext(entries?.find((entry) => entry.id === id));
}

/** Bulk messaging: one message, many sends, one context. */
export const BULK_MESSAGE_TOKEN_CONTEXT = "bulk-message";

/** A one-off compose screen's context, one per compose scope. */
export function composeTokenContextId(scope: ComposeScopeName): string {
  return `compose-${scope}`;
}

/**
 * A notifier's context, one per token-templated notifier.
 *
 * Derived from the plugin id on both sides — the server generates the
 * context from the id the notifier is registered under, and the id the
 * client names is stamped into the config schema at that same
 * registration, never hand-written.
 */
export function notifierTokenContextId(pluginId: string): string {
  return `notifier-${pluginId}`;
}

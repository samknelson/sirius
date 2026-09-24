import { logger } from "../../../logger";
// Static import: `server/lib/base-url` is a thin wrapper over the env
// registry, itself a pure leaf module with no imports at all.
import { absoluteBaseUrl } from "../../../lib/base-url";
import {
  onTokenPluginRegistered,
  registerTokenPlugin,
  tokenPluginRegistry,
} from "../registry";
import {
  ENTITY_PATH_SEGMENT,
  ENTITY_URL_SEGMENT,
  entityLocations,
  resolveEntityPath,
  sampleEntityPath,
  tabChoicesForKind,
  type ResolvedEntityLocation,
} from "../entity-location";
import type { TokenEntity, TokenEntityType } from "../types";

/**
 * `path` AND `url` LEAVES — GENERATED, NOT HAND-WRITTEN.
 *
 * A kind that declared where its records live (see `../entity-location`)
 * gets two leaves for free:
 *
 *   {{grievance.path}}              → /grievance/<id>
 *   {{grievance.url}}               → https://<site>/grievance/<id>
 *   {{grievance.path(tab="notes")}} → /grievance/<id>/notes
 *
 * Generated per kind rather than once for all of them, because the `tab`
 * argument's choices ARE per kind: a grievance's tabs are not a worker's,
 * and a picker offering a blank text box is exactly the guessing game
 * this replaces.
 *
 * `url` is a wrapper over `path`, never a parallel implementation: both
 * resolve through the one builder, so they cannot disagree, and when
 * there is no path (a snapshot row with no id, a deleted record) `url`
 * resolves to nothing too — never a bare origin, never a dangling slash.
 *
 * Marked `generated`, like the relation sweeps' segments: a hand-written
 * `path` on some kind still wins, in either registration order.
 */

/** Is a segment of this name already declared on this kind by hand? */
function segmentDeclared(name: string, kind: TokenEntityType): boolean {
  return tokenPluginRegistry
    .list()
    .some(
      (p) =>
        p.metadata.segmentName === name &&
        !p.metadata.generated &&
        p.metadata.inputTypes.includes(kind),
    );
}

/** What the leaves say they are — a borrowed page has to admit it. */
function describe(location: ResolvedEntityLocation, absolute: boolean): string {
  const what = absolute ? "Absolute link to" : "Relative path of";
  if (location.borrowed) {
    const owner = location.declaration.tabEntity.replace(/_/g, " ");
    return (
      `${what} the page that LISTS this record — the ${owner} ` +
      `${location.defaultTab.label.toLowerCase()} page it appears on, not a ` +
      `page for this record itself`
    );
  }
  return `${what} this record's page (add tab="…" for one of its sub-pages)`;
}

function entityOf(entity: unknown): TokenEntity | null {
  const e = entity as TokenEntity | null;
  return e && typeof e === "object" && e.row ? e : null;
}

function registerLeavesFor(location: ResolvedEntityLocation): string[] {
  const kind = location.kind;
  const ids: string[] = [];
  const choices = tabChoicesForKind(kind);
  const tabArg = {
    tab: {
      default: location.declaration.defaultTab,
      description: `Which of the ${location.kindLabel.toLowerCase()} page's tabs to link to`,
      choices,
    },
  };
  const samplePath = sampleEntityPath(kind) ?? "";

  if (!segmentDeclared(ENTITY_PATH_SEGMENT, kind)) {
    registerTokenPlugin({
      metadata: {
        id: `token.leaf.path.${kind}`,
        name: "Link path",
        shortLabel: "link path",
        description: describe(location, false),
        segmentName: ENTITY_PATH_SEGMENT,
        inputTypes: [kind],
        outputType: "value",
        args: tabArg,
        generated: true,
        requiredComponent: location.requiredComponent,
        defaultValue: "",
        example: samplePath,
      },
      async resolve(entity, args) {
        const e = entityOf(entity);
        if (!e) return null;
        return resolveEntityPath(e, args.tab);
      },
      // Argument-dependent sample: a fixed example would show the
      // record's own page while the author asked for a sub-page.
      sampleValue(args) {
        return sampleEntityPath(kind, args.tab) ?? "";
      },
    });
    ids.push(`token.leaf.path.${kind}`);
  }

  if (!segmentDeclared(ENTITY_URL_SEGMENT, kind)) {
    registerTokenPlugin({
      metadata: {
        id: `token.leaf.url.${kind}`,
        name: "Link URL",
        shortLabel: "link URL",
        description: describe(location, true),
        segmentName: ENTITY_URL_SEGMENT,
        inputTypes: [kind],
        outputType: "value",
        args: tabArg,
        generated: true,
        requiredComponent: location.requiredComponent,
        defaultValue: "",
        // The same origin {{system.base_url}} advertises in the picker;
        // a real preview renders the deployment's real one.
        example: `https://example.com${samplePath}`,
      },
      async resolve(entity, args) {
        const e = entityOf(entity);
        if (!e) return null;
        const path = resolveEntityPath(e, args.tab);
        // No path means no link: an origin on its own is not one.
        if (!path) return null;
        return `${absoluteBaseUrl()}${path}`;
      },
      sampleValue(args) {
        const path = sampleEntityPath(kind, args.tab);
        if (!path) return "";
        // Sample mode renders the deployment's REAL origin, the same way
        // {{system.base_url}} does, so the author can click the link.
        return `${absoluteBaseUrl()}${path}`;
      },
    });
    ids.push(`token.leaf.url.${kind}`);
  }

  return ids;
}

/**
 * Register the leaves for every kind that has declared a location, and —
 * once — subscribe to later registrations so a kind registered after the
 * first render gets them too.
 */
export function registerEntityPathTokens(): string[] {
  const swept = new Set<TokenEntityType>();
  let generating = false;

  function sweep(): string[] {
    const generated: string[] = [];
    generating = true;
    try {
      for (const location of entityLocations().values()) {
        if (swept.has(location.kind)) continue;
        swept.add(location.kind);
        generated.push(...registerLeavesFor(location));
      }
    } finally {
      generating = false;
    }
    return generated;
  }

  const generated = sweep();

  onTokenPluginRegistered(() => {
    // The sweep's own registrations are the leaves themselves.
    if (generating) return;
    const late = sweep();
    if (late.length) {
      logger.info("Token path/url leaves generated for a late entity kind", {
        service: "tokens",
        plugins: late,
      });
    }
  });

  return generated;
}

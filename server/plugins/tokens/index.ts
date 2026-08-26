import { logger } from "../../logger";
import { registerPluginKind } from "../_core/kinds";
import { tokenPluginRegistry } from "./registry";
import { validateTokenPreviewEntities } from "./preview-entities";
import { validateTokenSampleSets } from "./sample-sets";
import { registerOptionsTokens } from "./plugins/options";
import { registerEntityRelationTokens } from "./plugins/entity-relations";
import { registerEntityPathTokens } from "./plugins/entity-paths";
import { validateTokenEntityLocations } from "./entity-location";

export * from "./types";
export {
  listTokenPreviewRoots,
  type TokenPreviewRoot,
} from "./preview-roots";
export {
  resolveTokenPreviewEntity,
  listTokenPreviewEntityKinds,
  type TokenPreviewEntityResult,
} from "./preview-entities";
export {
  getSampleSetsForKind,
  resolveSampleSet,
  sampleSetValue,
  listSampleSetChoicesForKind,
  DEFAULT_SAMPLE_SET_ID,
  type TokenSampleSetChoice,
} from "./sample-sets";
export { tokenPluginRegistry, registerTokenPlugin, findSegmentPlugin } from "./registry";
export {
  renderTokens,
  evaluateChain,
  createTokenEvalContext,
  buildSegmentSpecsForRoots,
  buildFieldCatalog,
  buildTokenCatalogForRoots,
  validateTokenExpressionForRoots,
  describeChain,
} from "./evaluate";
export {
  registerTokenContextRoot,
  listTokenContextRoots,
  getTokenContextRoot,
  type TokenContextRootDeclaration,
} from "./context-roots";
export { missingCatalogFields } from "./root-coverage";
export {
  resolveEntityPath,
  entityDeclaresLocation,
  listEntityLocationKinds,
  tabChoicesForKind,
} from "./entity-location";
export {
  listTokenTreeRoots,
  expandTokenType,
  searchTokenTree,
  type TokenTreeRoot,
  type TokenTreeChild,
  type TokenTreeSearchHit,
  type TokenTypeExpansion,
} from "./tree";

let kindRegistered = false;
function registerTokenKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "token",
    registry: tokenPluginRegistry,
    label: "Tokens",
    description:
      "Chained template tokens ({{worker.field(name=\"job_title\")}}, {{contact.address.field(name=\"street\")}}) resolved per recipient when messages are rendered.",
    // Token authoring surfaces (bulk messages) are gated by bulk.edit;
    // the kind itself carries the same policy for manifest visibility.
    requiredPolicy: "bulk.edit",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  kindRegistered = true;
}

/**
 * Initialize the token plugin system: register the kind. Plugins
 * self-register via the side-effect imports at the bottom of this
 * file. There is no config adapter — token plugins have no persisted
 * configuration; the registry is the single source of truth.
 */
export function initializeTokenPluginSystem(): void {
  registerTokenKind();
  // Generated segments come first: they are derived from what the
  // hand-written plugins declare (their tables' foreign keys), so they
  // must exist before the projections below are validated.
  const optionsTokens = registerOptionsTokens();
  // Entity relations come after the options sweep: an options table is
  // neither owner nor target here, and running second keeps the two
  // sweeps' skip rules reading in the order they are documented.
  const entityRelationTokens = registerEntityRelationTokens();
  // Where each kind's records LIVE, checked against the live tab
  // registry before anything is derived from it: a declaration naming a
  // tab that does not exist would otherwise surface as a 404 in a
  // delivered message.
  const entityLocationKinds = validateTokenEntityLocations();
  // The `path`/`url` leaves those declarations earn.
  const entityPathTokens = registerEntityPathTokens();
  // Project the plugins' `previewEntity` and `sampleSets` declarations
  // into their per-kind registries once at boot, so two declarations for
  // one entity kind fail loudly here instead of at the first preview.
  const previewEntityKinds = validateTokenPreviewEntities();
  const sampleSetKinds = validateTokenSampleSets();
  logger.info("Token plugins registered", {
    service: "tokens",
    plugins: tokenPluginRegistry.listIds(),
    previewEntityKinds,
    sampleSetKinds,
    optionsTokens,
    entityRelationTokens,
    entityLocationKinds,
    entityPathTokens,
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/field";
import "./plugins/contact";
import "./plugins/worker";
import "./plugins/employer";
import "./plugins/employer-contact";
import "./plugins/trust-provider";
import "./plugins/system";
import "./plugins/address";
import "./plugins/bulk-participant";
import "./plugins/event";
import "./plugins/sitespecific-t631-interview";
import "./plugins/sitespecific-bao-case";
import "./plugins/dispatch";
import "./plugins/edls";
import "./plugins/grievance";
import "./plugins/compliance";

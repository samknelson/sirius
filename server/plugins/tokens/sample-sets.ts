import { normalizeFieldName } from "@shared/tokens";
import { tokenPluginRegistry } from "./registry";
import type { TokenEntityType, TokenPlugin, TokenSampleSet } from "./types";

export type { TokenSampleSet } from "./types";

/**
 * Named sample data, keyed by token entity kind.
 *
 * A template preview renders against sample data by default — never
 * against whatever real record the author can name. The sample values
 * come from here: each kind's owning plugin declares one or more named
 * personas (`sampleSets`), and set ids are shared across kinds so ONE
 * pick ("Martian") renders a coherent story through every token in the
 * template — martian contact, martian worker, martian employer.
 *
 * Nothing is registered here directly: this module projects the plugin
 * registry, rebuilt on demand (the registry is tiny and some plugins
 * register lazily), and refuses two declarations for one kind.
 */
interface RegisteredSampleSets {
  pluginId: string;
  sets: TokenSampleSet[];
}

function collect(): Map<TokenEntityType, RegisteredSampleSets> {
  const map = new Map<TokenEntityType, RegisteredSampleSets>();
  // list() (not listEnabledSync): sample data is static metadata and is
  // not gated by components — it never touches the database.
  for (const plugin of tokenPluginRegistry.list()) {
    const sets = plugin.metadata.sampleSets;
    if (!sets || sets.length === 0) continue;
    const kind = plugin.metadata.outputType;
    const existing = map.get(kind);
    if (existing) {
      throw new Error(
        `Two token plugins declare sample sets for kind "${kind}" ` +
          `(${existing.pluginId} and ${plugin.metadata.id}) — declare them once, ` +
          `on the plugin that owns the kind.`,
      );
    }
    map.set(kind, { pluginId: plugin.metadata.id, sets });
  }
  return map;
}

/** Every declared sample set of one entity kind, in declaration order. */
export function getSampleSetsForKind(kind: TokenEntityType): TokenSampleSet[] {
  return collect().get(kind)?.sets ?? [];
}

/**
 * The set a render uses for one kind: the chosen id when this kind
 * declares it, else the kind's first set, else nothing (each token then
 * renders its own `example`).
 */
export function resolveSampleSet(
  kind: TokenEntityType,
  sampleSetId: string | undefined,
): TokenSampleSet | undefined {
  const sets = getSampleSetsForKind(kind);
  if (sets.length === 0) return undefined;
  return (sampleSetId && sets.find((s) => s.id === sampleSetId)) || sets[0];
}

/**
 * The value a sample set gives for one leaf of an entity kind, or
 * undefined when the set does not name it. `key` is the `field(name=…)`
 * argument for plain field leaves, or the leaf's segment name.
 */
export function sampleSetValue(
  kind: TokenEntityType,
  sampleSetId: string | undefined,
  key: string,
): string | undefined {
  const set = resolveSampleSet(kind, sampleSetId);
  if (!set) return undefined;
  const wanted = normalizeFieldName(key);
  for (const [name, value] of Object.entries(set.values)) {
    if (normalizeFieldName(name) === wanted) return value || undefined;
  }
  return undefined;
}

/** One selectable sample persona, as offered to a template editor. */
export interface TokenSampleSetChoice {
  id: string;
  label: string;
}

/**
 * The sample personas offered for ONE root: the sets its kind declares.
 * The persona is chosen per root, so what is offered is what that
 * kind actually has — never a union that renders as somebody else's
 * first set.
 *
 * Always non-empty: a kind that declares nothing still offers the
 * implicit persona, where every token renders its own `example`.
 */
export function listSampleSetChoicesForKind(
  kind: TokenEntityType,
): TokenSampleSetChoice[] {
  const sets = getSampleSetsForKind(kind);
  if (sets.length === 0) {
    return [{ id: DEFAULT_SAMPLE_SET_ID, label: "Sample data" }];
  }
  return sets.map((set) => ({ id: set.id, label: set.label }));
}

/** Fallback id when nothing declares a named set. */
export const DEFAULT_SAMPLE_SET_ID = "sample";

/**
 * Boot-time author check: one declaration per kind, and no set with an
 * empty id/label. Field-name validity is NOT checked — nothing walks the
 * field catalog to confirm a declared sample field exists. Returns the
 * kinds that declare sample sets.
 */
export function validateTokenSampleSets(): TokenEntityType[] {
  const map = collect();
  for (const [kind, { pluginId, sets }] of map) {
    const seen = new Set<string>();
    for (const set of sets) {
      if (!set.id?.trim() || !set.label?.trim()) {
        throw new Error(
          `${pluginId}: a sample set for kind "${kind}" is missing an id or label.`,
        );
      }
      if (seen.has(set.id)) {
        throw new Error(
          `${pluginId}: duplicate sample set id "${set.id}" for kind "${kind}".`,
        );
      }
      seen.add(set.id);
    }
  }
  return Array.from(map.keys()).sort();
}

/** Plugins declaring sample sets, for author-check reporting. */
export function listSampleSetDeclarations(): Array<{
  kind: TokenEntityType;
  plugin: TokenPlugin | undefined;
  sets: TokenSampleSet[];
}> {
  const plugins = tokenPluginRegistry.list();
  return Array.from(collect(), ([kind, { pluginId, sets }]) => ({
    kind,
    plugin: plugins.find((p) => p.metadata.id === pluginId),
    sets,
  }));
}

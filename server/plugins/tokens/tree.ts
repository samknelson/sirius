import { MAX_CHAIN_DEPTH, type TokenArgSpec } from "@shared/tokens";
import { tokenPluginRegistry } from "./registry";
import { buildFieldCatalog } from "./evaluate";
import { isComponentEnabledSync } from "../../services/component-cache";
import type { TokenEntityType, TokenPlugin } from "./types";

/**
 * BROWSABLE token tree: one level at a time.
 *
 * The flat catalog (`buildTokenCatalog`) enumerates every chain up
 * front, which forces a depth cap and turns a rich record graph into a
 * thousand-row list. This API answers the two questions a tree picker
 * actually asks — "what roots may I start at?" and "what can I write
 * after a chain that has arrived at type X?" — so a chain of ANY depth
 * stays browsable and nothing is enumerated until the author opens it.
 *
 * Relations that carry arguments are first-class here: a child names
 * its argument spec and the exact text to append, so
 * `dispatch.worker.contact.address(primary="true").field(name="full")`
 * is reachable by clicking, not by remembering the syntax.
 */

/** One root a chain may start at, for the surface being edited. */
export interface TokenTreeRoot {
  /** Root segment name as written in templates. */
  name: string;
  label: string;
  description?: string;
  /** Entity type the root produces — expand it with `expandTokenType`. */
  type: TokenEntityType;
  /** True for a root the surface must seed (a notifier's own records). */
  contextRoot: boolean;
  /** The root's own record is picked per preview (never the recipient). */
  recipientRooted: boolean;
  /**
   * Field the root's kind renders when a chain stops at it, if any —
   * `{{contact}}` is a usable token when the kind declares one, so the
   * picker can offer the root itself as an insertable value.
   */
  defaultLeaf?: string;
}

export type TokenTreeChildKind = "relation" | "leaf" | "field";

/** One thing an author can write after a chain that has arrived at a type. */
export interface TokenTreeChild {
  kind: TokenTreeChildKind;
  /** Segment name ("worker", "date", "field"). */
  segment: string;
  label: string;
  description?: string;
  /**
   * Exactly what to append to the parent chain, arguments included:
   * `.worker`, `.address(primary="true")`, `.field(name="ssn")`.
   * Required arguments with no default appear as empty strings for the
   * author (or the picker) to fill in.
   */
  suffix: string;
  /** Relations only: the type produced, to expand next. */
  outputType?: TokenEntityType;
  /** Declared arguments, so a picker can offer them as inputs. */
  args?: Record<string, TokenArgSpec>;
  /** True when an argument must be filled before the token resolves. */
  needsArgument?: boolean;
  /** Relations only: field the kind renders when the chain stops here. */
  defaultLeaf?: string;
  defaultValue?: string;
  example?: string;
}

/** Everything reachable from one entity type. */
export interface TokenTypeExpansion {
  type: TokenEntityType;
  label: string;
  /** The type's field names can't be enumerated — any name is accepted. */
  fieldsOpen: boolean;
  children: TokenTreeChild[];
}

/** Human name for an entity kind, from the plugin that owns it. */
function kindLabel(type: TokenEntityType, plugins: TokenPlugin[]): string {
  const owner =
    plugins.find(
      (p) =>
        p.metadata.outputType === type &&
        (p.metadata.inputTypes.includes("root") || p.metadata.inputTypes.length === 0),
    ) ?? plugins.find((p) => p.metadata.outputType === type);
  return owner?.metadata.name ?? type;
}

/** The default leaf declared for a kind, if any. */
function defaultLeafOf(type: TokenEntityType, plugins: TokenPlugin[]): string | undefined {
  return plugins.find(
    (p) => p.metadata.outputType === type && p.metadata.defaultLeaf !== undefined,
  )?.metadata.defaultLeaf;
}

/** A tab registry component gate, which may be a pipe-separated OR. */
function componentAllowsChoice(component: string | undefined): boolean {
  if (!component) return true;
  return component.split("|").some((c) => isComponentEnabledSync(c.trim()));
}

/**
 * The argument specs as the PICKER should see them: a choice whose
 * component is switched off is not offered.
 *
 * Only the offer narrows. Validation keeps every declared choice, so
 * toggling a component never invalidates a template that already names
 * one of its tabs — and the argument's own default is always offered,
 * or the picker would show a value that is not in its own list.
 */
function offeredArgs(
  args: Record<string, TokenArgSpec> | undefined,
): Record<string, TokenArgSpec> | undefined {
  if (!args) return undefined;
  const out: Record<string, TokenArgSpec> = {};
  for (const [name, spec] of Object.entries(args)) {
    out[name] = spec.choices
      ? {
          ...spec,
          choices: spec.choices.filter(
            (c) => c.value === spec.default || componentAllowsChoice(c.component),
          ),
        }
      : spec;
  }
  return out;
}

/** `(a="x", b="")` for the arguments a segment must carry, or "". */
function argSuffix(args: Record<string, TokenArgSpec> | undefined): {
  text: string;
  needsArgument: boolean;
} {
  const entries = Object.entries(args ?? {}).filter(
    ([, spec]) => spec.required || spec.default !== undefined,
  );
  // Only REQUIRED arguments are written out: an argument with a default
  // is optional noise until the author wants to change it.
  const required = entries.filter(([, spec]) => spec.required);
  if (required.length === 0) return { text: "", needsArgument: false };
  const text = required
    .map(([name, spec]) => `${name}="${spec.default ?? ""}"`)
    .join(", ");
  const needsArgument = required.some(([, spec]) => spec.default === undefined);
  return { text: `(${text})`, needsArgument };
}

/**
 * The roots a surface offers, EXACTLY the ones it named and in the
 * order it named them.
 *
 * Nothing is appended from the registry. A root the surface did not
 * name does not exist for its authors: a bulk message is a list of
 * contacts, so offering it the employer root would invite a token whose
 * record the message has never heard of. The list is the surface's
 * statement about itself, so it is also the list its catalog, its
 * validation and its preview panel are built from.
 *
 * A name no enabled root answers to is skipped — a root whose component
 * is off is simply not on offer.
 */
export function listTokenTreeRoots(rootNames: string[]): TokenTreeRoot[] {
  const plugins = tokenPluginRegistry.listEnabledSync();
  const out: TokenTreeRoot[] = [];
  for (const name of rootNames) {
    if (out.some((r) => r.name === name)) continue;
    const plugin = plugins.find(
      (p) =>
        p.metadata.segmentName === name && p.metadata.inputTypes.includes("root"),
    );
    if (!plugin) continue;
    out.push({
      name,
      label: plugin.metadata.name,
      description: plugin.metadata.description,
      type: plugin.metadata.outputType,
      contextRoot: Boolean(plugin.metadata.contextRoot),
      recipientRooted: Boolean(plugin.metadata.recipientRooted),
      defaultLeaf: defaultLeafOf(plugin.metadata.outputType, plugins),
    });
  }
  return out;
}

/**
 * What can follow a chain that has arrived at `type`: its relations
 * (with their arguments), its value leaves, and its field names.
 *
 * Hidden-from-catalog plugins ARE included: hiding keeps them out of
 * the flat bulk-messaging list, but an author who has already navigated
 * to the type they hang off is entitled to see them.
 */
export function expandTokenType(type: TokenEntityType): TokenTypeExpansion {
  const plugins = tokenPluginRegistry.listEnabledSync();
  const catalog = buildFieldCatalog()[type];
  const children: TokenTreeChild[] = [];

  for (const plugin of plugins) {
    const meta = plugin.metadata;
    const applies =
      meta.inputTypes.includes(type) ||
      (meta.inputTypes.includes("*") && type !== "root" && type !== "value");
    if (!applies) continue;
    // The generic field segment is presented as the type's field list
    // below, not as one opaque "field(name=…)" child.
    if (meta.segmentName === "field") continue;
    const { text, needsArgument } = argSuffix(meta.args);
    if (meta.outputType === "value") {
      children.push({
        kind: "leaf",
        segment: meta.segmentName,
        label: meta.name,
        description: meta.description,
        suffix: `.${meta.segmentName}${text}`,
        args: offeredArgs(meta.args),
        needsArgument,
        defaultValue: meta.defaultValue,
        example: meta.example,
      });
    } else {
      children.push({
        kind: "relation",
        segment: meta.segmentName,
        label: meta.name,
        description: meta.description,
        suffix: `.${meta.segmentName}${text}`,
        outputType: meta.outputType,
        args: offeredArgs(meta.args),
        needsArgument,
        defaultLeaf: defaultLeafOf(meta.outputType, plugins),
      });
    }
  }

  const fieldsOpen = Boolean(catalog?.open);
  for (const name of catalog?.names ?? []) {
    children.push({
      kind: "field",
      segment: "field",
      label: name,
      suffix: `.field(name="${name}")`,
    });
  }
  if (fieldsOpen) {
    // Nothing to enumerate: the picker asks for the field name, so the
    // author still gets a complete token rather than a stub to finish.
    children.push({
      kind: "field",
      segment: "field",
      label: "Field…",
      description: "Any field of this record — name it",
      suffix: '.field(name="")',
      args: { name: { required: true, description: "Field name on this record" } },
      needsArgument: true,
    });
  }

  return {
    type,
    label: kindLabel(type, plugins),
    fieldsOpen,
    children,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Search across the tree
// ─────────────────────────────────────────────────────────────────────

/** One insertable token found by searching the tree. */
export interface TokenTreeSearchHit {
  /** Token expression, braces excluded: `dispatch.worker.field(name="ssn")`. */
  expression: string;
  /** Human path from the root down to the hit, for disambiguation. */
  path: string[];
  kind: TokenTreeChildKind | "root";
  label: string;
  description?: string;
}

/**
 * How deep search walks (the grammar's own cap — a longer chain doesn't
 * parse, a shorter cap would hide tokens the picker can still browse to)
 * and how many hits it returns.
 */
const SEARCH_MAX_DEPTH = MAX_CHAIN_DEPTH;
const SEARCH_LIMIT = 60;
/** Ceiling on expansions per search, so a cyclic graph can't run away. */
const SEARCH_MAX_NODES = 400;

function matches(query: string, ...candidates: (string | undefined)[]): boolean {
  return candidates.some((c) => c !== undefined && c.toLowerCase().includes(query));
}

/**
 * Find every insertable token whose own name — or the name of a record
 * on the way to it — matches `query`. Searching "dispatch" therefore
 * finds the dispatch record's fields, and searching a field name finds
 * it under every record that has it, each hit carrying its full path.
 *
 * Walks the same lazy tree the picker browses, breadth-first, so hits
 * come back shallowest-first and a cyclic relation graph terminates.
 */
export function searchTokenTree(
  rootNames: string[],
  query: string,
  opts: { limit?: number; maxDepth?: number } = {},
): TokenTreeSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = opts.limit ?? SEARCH_LIMIT;
  const maxDepth = opts.maxDepth ?? SEARCH_MAX_DEPTH;

  const expansions = new Map<TokenEntityType, TokenTypeExpansion>();
  const expand = (type: TokenEntityType): TokenTypeExpansion => {
    let e = expansions.get(type);
    if (!e) {
      e = expandTokenType(type);
      expansions.set(type, e);
    }
    return e;
  };

  /** Hits are collected wide, then ranked, so a record whose own name
   *  matched doesn't bury a field that matched exactly. */
  interface RankedHit extends TokenTreeSearchHit {
    score: number;
    depth: number;
  }
  const hits: RankedHit[] = [];
  const seen = new Set<string>();
  const push = (hit: RankedHit) => {
    if (seen.has(hit.expression)) return;
    seen.add(hit.expression);
    hits.push(hit);
  };
  /** 0 exact name, 1 prefix, 2 contains, 3 only an ancestor matched. */
  const scoreOf = (...names: (string | undefined)[]): number => {
    const lower = names.filter((n): n is string => n !== undefined).map((n) => n.toLowerCase());
    if (lower.some((n) => n === q)) return 0;
    if (lower.some((n) => n.startsWith(q))) return 1;
    if (lower.some((n) => n.includes(q))) return 2;
    return 3;
  };
  const collectLimit = limit * 4;

  interface Node {
    expression: string;
    path: string[];
    type: TokenEntityType;
    depth: number;
    /** A record on the path already matched: offer everything under it. */
    pathMatched: boolean;
  }

  const queue: Node[] = [];
  for (const root of listTokenTreeRoots(rootNames)) {
    const rootMatched = matches(q, root.name, root.label);
    if (rootMatched && root.defaultLeaf !== undefined) {
      push({
        expression: root.name,
        path: [root.label],
        kind: "root",
        label: root.label,
        description: root.description,
        score: scoreOf(root.name, root.label),
        depth: 0,
      });
    }
    queue.push({
      expression: root.name,
      path: [root.label],
      type: root.type,
      depth: 1,
      pathMatched: rootMatched,
    });
  }

  let expanded = 0;
  while (queue.length > 0 && hits.length < collectLimit && expanded < SEARCH_MAX_NODES) {
    const node = queue.shift()!;
    expanded++;
    // Every child adds a segment: at the cap the chain is already as
    // long as the grammar allows, so nothing below it is insertable.
    if (node.depth >= maxDepth) continue;
    for (const child of expand(node.type).children) {
      // The open-field placeholder inserts an unfinished stub — never a
      // search result.
      if (child.kind === "field" && child.needsArgument) continue;
      const childMatched = matches(q, child.segment, child.label);
      const include = childMatched || node.pathMatched;
      const expression = `${node.expression}${child.suffix}`;
      const path = [...node.path, child.label];

      if (child.kind === "relation") {
        if (include && child.defaultLeaf !== undefined && !child.needsArgument) {
          push({
            expression,
            path,
            kind: "relation",
            label: child.label,
            description: child.description,
            score: scoreOf(child.segment, child.label),
            depth: node.depth,
          });
        }
        // Only walk on when the record we'd arrive at can still offer a
        // segment of its own within the cap.
        if (node.depth + 1 < maxDepth && child.outputType && !child.needsArgument) {
          queue.push({
            expression,
            path,
            type: child.outputType,
            depth: node.depth + 1,
            pathMatched: node.pathMatched || childMatched,
          });
        }
        continue;
      }
      if (include && !child.needsArgument) {
        push({
          expression,
          path,
          kind: child.kind,
          label: child.label,
          description: child.description,
          score: scoreOf(child.segment, child.label),
          depth: node.depth,
        });
      }
      if (hits.length >= collectLimit) break;
    }
  }

  // Rank: the closest name match first, shallower chains before deeper
  // ones, and otherwise the order the tree was walked in.
  return hits
    .map((hit, i) => ({ hit, i }))
    .sort(
      (a, b) =>
        a.hit.score - b.hit.score || a.hit.depth - b.hit.depth || a.i - b.i,
    )
    .slice(0, limit)
    .map(({ hit }) => {
      const { score: _score, depth: _depth, ...rest } = hit;
      return rest;
    });
}

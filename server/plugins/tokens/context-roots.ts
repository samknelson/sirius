import {
  bumpTokenRegistryVersion,
  registerTokenPlugin,
  tokenPluginRegistry,
} from "./registry";
import type { TokenEntityType } from "./types";

/**
 * NAMED RECORD ROOTS.
 *
 * A surface that renders a template about specific records (an event
 * notifier: "the dispatch status row this event is about", "the
 * interview", "the settlement") seeds those records as roots of their
 * own — `{{dispatch.field(name="status")}}`,
 * `{{sitespecific_t631_interview.worker.contact.field(name="display_name")}}`.
 *
 * The root is a plain token plugin like any other, registered here so
 * the declaration stays a one-liner at the surface's side. Two things
 * make it a CONTEXT root:
 *   - it resolves from `ctx.roots[<name>]`, the record the render was
 *     seeded with, and nothing else (no recipient fallback, no lookup);
 *   - it is offered only where the surface names it (`contextRoot`), so
 *     bulk messaging — which has no notifier records — still treats
 *     `{{dispatch.…}}` as an unknown token.
 *
 * Declaring the same name twice is normal (two notifiers about the same
 * kind of record); declaring it twice with DIFFERENT kinds is a bug —
 * the name would mean two things in two editors — and throws.
 */
export interface TokenContextRootDeclaration {
  /** Root name as written in templates. Also the segment name. */
  name: string;
  /** Token entity kind the seeded record belongs to. */
  kind: TokenEntityType;
  /** Human label for pickers ("Dispatch status"). First one wins. */
  label: string;
  description?: string;
  /**
   * Values the seeding surface MERGES onto the row beyond its table
   * columns (`status_label`, `action`). Declaring them is what makes
   * `{{dispatch.field(name="status_label")}}` a valid token instead of
   * an "[unknown token: …]" at delivery time.
   */
  fields?: string[];
  /** Component that must be enabled for the root to exist. */
  requiredComponent?: string;
}

interface RegisteredContextRoot extends TokenContextRootDeclaration {
  /** Mutable, shared with the registered plugin's metadata. */
  fields: string[];
}

const declarations = new Map<string, RegisteredContextRoot>();

export const CONTEXT_ROOT_PLUGIN_PREFIX = "token.context_root.";

/**
 * Declare (idempotently) a named record root. Safe to call once per
 * declaring surface: repeat declarations of the same name and kind
 * merge their extra fields, a conflicting kind throws.
 */
export function registerTokenContextRoot(
  declaration: TokenContextRootDeclaration,
): void {
  const existing = declarations.get(declaration.name);
  if (existing) {
    if (existing.kind !== declaration.kind) {
      throw new Error(
        `Token root "${declaration.name}" is already declared for entity kind ` +
          `"${existing.kind}"; it cannot also mean "${declaration.kind}". ` +
          `Two surfaces seeding different kinds must use different root names.`,
      );
    }
    // One root, one gate. Sharing a name means sharing WHEN the root
    // exists: the first declaration's component would otherwise decide
    // for a surface that never mentioned it.
    if (existing.requiredComponent !== declaration.requiredComponent) {
      throw new Error(
        `Token root "${declaration.name}" is already declared behind component ` +
          `"${existing.requiredComponent ?? "(none)"}"; it cannot also require ` +
          `"${declaration.requiredComponent ?? "(none)"}". Surfaces sharing a root ` +
          `name must gate it the same way, or use different root names.`,
      );
    }
    let added = false;
    for (const field of declaration.fields ?? []) {
      // Mutates the array the plugin's metadata holds, so a field
      // declared by the second surface joins the kind's catalog too.
      if (!existing.fields.includes(field)) {
        existing.fields.push(field);
        added = true;
      }
    }
    // The registered plugin's metadata just changed shape; derived
    // caches (the field catalog) must not keep serving the old field
    // list, or a token validates at save time and renders as unknown at
    // delivery time.
    if (added) bumpTokenRegistryVersion();
    return;
  }

  // The name must be free across ALL roots, not just declared ones: an
  // ordinary root (contact, worker, system) or a framework context root
  // (the event envelope, registered as a plain plugin) would be
  // shadowed by a same-named record root, and which one a chain
  // resolved to would depend on registration order.
  const taken = tokenPluginRegistry
    .list()
    .find(
      (p) =>
        p.metadata.segmentName === declaration.name &&
        p.metadata.inputTypes.includes("root"),
    );
  if (taken) {
    throw new Error(
      `Token root "${declaration.name}" is already the "${taken.metadata.name}" root ` +
        `(${taken.metadata.id}); a named record root cannot shadow it. ` +
        `Pick a name that says what the record is.`,
    );
  }

  const entry: RegisteredContextRoot = {
    ...declaration,
    fields: [...(declaration.fields ?? [])],
  };
  declarations.set(entry.name, entry);

  registerTokenPlugin({
    metadata: {
      id: `${CONTEXT_ROOT_PLUGIN_PREFIX}${entry.name}`,
      name: entry.label,
      description: entry.description ?? `The ${entry.label.toLowerCase()} this message is about`,
      segmentName: entry.name,
      inputTypes: ["root"],
      outputType: entry.kind,
      contextRoot: true,
      // The kind's columns come from its descriptor plugin; this root
      // contributes only the merged extras the surface declared.
      entityFields: entry.fields,
      requiredComponent: entry.requiredComponent,
    },
    async resolve(_entity, _args, ctx) {
      // The seeded record IS the root. No fallback: an unseeded context
      // root renders sample data in a preview and the chain's default
      // at delivery, never someone else's record.
      return ctx.roots[entry.name] ?? null;
    },
  });
}

/** Every declared context root, in declaration order. */
export function listTokenContextRoots(): TokenContextRootDeclaration[] {
  return Array.from(declarations.values());
}

/** The declaration behind a root name, if it is a context root. */
export function getTokenContextRoot(
  name: string,
): TokenContextRootDeclaration | undefined {
  return declarations.get(name);
}

/**
 * Test/boot helper: the registered context-root plugin ids, so a caller
 * can assert the projection happened (nothing else should need this).
 */
export function listTokenContextRootPluginIds(): string[] {
  return tokenPluginRegistry
    .listIds()
    .filter((id) => id.startsWith(CONTEXT_ROOT_PLUGIN_PREFIX));
}

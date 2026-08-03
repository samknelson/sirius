import { createElement, type ComponentType } from "react";

/**
 * Shared client-side helper for kinds whose plugins ship a React
 * component. Each kind keeps its own folder under
 * `client/src/plugins/<kind>/<plugin-id>/<ComponentName>.tsx`; the
 * manifest entry names the component with the id
 * `<plugin-id>:<ComponentName>`. This helper returns a typed lookup
 * function over all components found for the given kind.
 *
 * `glob` must be the result of `import.meta.glob(...)` evaluated at the
 * caller's site. Vite resolves glob patterns at build time and rejects
 * dynamic strings -- passing `kind` here and trying to glob a pattern
 * like `./KIND-SLASH-STAR-SLASH-STAR.tsx` internally would fail at
 * build time. So the caller owns the glob call and we own the
 * registration shape. Please don't "simplify" this by trying to derive
 * the glob from `kind` inside this helper; that path has been tried
 * and Vite will refuse to compile it.
 */
export function createPluginComponentRegistry<TProps>(opts: {
  kind: string;
  glob: Record<string, Record<string, unknown>>;
}): {
  has: (id: string) => boolean;
  resolve: (id: string) => ComponentType<TProps>;
} {
  const registry = new Map<string, ComponentType<TProps>>();

  for (const [path, mod] of Object.entries(opts.glob)) {
    const match = path.match(/^\.\/([^/]+)\/([^/]+)\.tsx$/);
    if (!match) continue;
    const [, namespace, file] = match;
    const named = mod[file] as ComponentType<TProps> | undefined;
    const fallback = (mod as { default?: ComponentType<TProps> }).default;
    const component = named ?? fallback;
    if (!component) continue;
    registry.set(`${namespace}:${file}`, component);
  }

  return {
    has: (id: string) => registry.has(id),
    resolve: (id: string) => {
      const component = registry.get(id);
      if (!component) {
        const [namespace, name] = id.split(":");
        console.error(
          `Plugin component "${id}" (kind=${opts.kind}) not found. ` +
            `Add client/src/plugins/${opts.kind}/${namespace}/${name}.tsx ` +
            `exporting a function named "${name}".`,
        );
        return createMissingComponentFallback<TProps>({
          kind: opts.kind,
          id,
          namespace,
          name,
        });
      }
      return component;
    },
  };
}

/**
 * Fallback rendered when a plugin-declared component id has no matching
 * file. Rendering an inline error card instead of throwing keeps the
 * surrounding page (e.g. /wizards/:id) alive when a component file is
 * missing or mistyped. Built with `createElement` so this file can stay
 * a plain `.ts` module.
 */
function createMissingComponentFallback<TProps>(info: {
  kind: string;
  id: string;
  namespace: string;
  name: string;
}): ComponentType<TProps> {
  const MissingPluginComponent = () =>
    createElement(
      "div",
      {
        className:
          "rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-sm",
        "data-testid": `error-missing-plugin-component-${info.namespace}-${info.name}`,
      },
      createElement(
        "p",
        { className: "font-medium text-destructive" },
        `This view failed to load: component "${info.name}" is missing.`,
      ),
      createElement(
        "p",
        { className: "mt-2 text-muted-foreground" },
        `The "${info.namespace}" plugin (kind=${info.kind}) declares a component ` +
          `"${info.id}" that has no matching file. Expected ` +
          `client/src/plugins/${info.kind}/${info.namespace}/${info.name}.tsx ` +
          `exporting a function named "${info.name}".`,
      ),
    );
  MissingPluginComponent.displayName = `MissingPluginComponent(${info.id})`;
  return MissingPluginComponent;
}

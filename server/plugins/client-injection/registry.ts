import type { Request } from "express";
import { PluginRegistry } from "../_core";
import type {
  ClientInjectionPlugin,
  ClientInjectionManifestEntry,
  ClientInjectionData,
  ResolvedInjection,
  ResolvedInjectionManifest,
} from "./types";

export const clientInjectionRegistry = new PluginRegistry<
  ClientInjectionPlugin,
  ClientInjectionManifestEntry
>({
  kind: "client-injection",
  getMetadata: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
  }),
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    slot: p.slot,
    kind: p.kind,
    order: p.order ?? 100,
    requiredComponent: p.requiredComponent,
  }),
});

/**
 * Walk every registered client-injection plugin, drop ones whose
 * required component is disabled, run their resolver, drop entries
 * that resolve to null, and group the rest by slot. The order within
 * a slot is `plugin.order ?? 100` ascending, then registration order
 * (preserved by the underlying Map).
 */
/**
 * Convenience helper used by individual plugin files to self-register
 * at module top level. Mirrors `registerChargePlugin` / `registerEligibilityPlugin`.
 */
export function registerClientInjection(plugin: ClientInjectionPlugin): void {
  clientInjectionRegistry.register(plugin);
}

/**
 * Resolve the live client injections from the unified `plugin_configs` store.
 *
 * Row-driven (Task #397): every injection is a `client-injection` plugin_config
 * row. For each ENABLED row we look up its registered impl by `pluginId`, merge
 * the impl's static defaults with the row's editable `data`
 * ({slot,kind,src,code,attrs}), run the impl's `resolve(...)` if present (this
 * is where server-only secrets like WEGLOT_API_KEY are read — never persisted),
 * and emit the final injection. Component ownership is handled by the component
 * lifecycle toggling each owned row's `enabled` flag, so the resolver gates
 * purely on `enabled` and no longer consults `requiredComponent`.
 *
 * The stable client-side element id is the row's `siriusId` when present (so a
 * component-owned row keeps a deterministic id) and otherwise the row id.
 */
export async function resolveClientInjections(
  req: Request,
): Promise<ResolvedInjectionManifest> {
  const { storage } = await import("../../storage");
  const rows = await storage.pluginConfigs.getByType("client-injection");

  const out: ResolvedInjection[] = [];
  for (const row of rows) {
    if (!row.enabled) continue;
    const impl = clientInjectionRegistry.get(row.pluginId);
    if (!impl) continue;

    const data = (row.data ?? {}) as ClientInjectionData;
    const slot = data.slot ?? impl.slot;
    const kind = data.kind ?? impl.kind;
    let src = data.src ?? impl.src;
    let code = data.code ?? impl.code;
    let attrs: Record<string, string | boolean> = {
      ...(impl.attrs ?? {}),
      ...(data.attrs ?? {}),
    };

    if (impl.resolve) {
      const resolved = await impl.resolve({ req, env: process.env });
      if (resolved === null || resolved === undefined) continue;
      if (resolved.src !== undefined) src = resolved.src;
      if (resolved.code !== undefined) code = resolved.code;
      if (resolved.attrs !== undefined) attrs = { ...attrs, ...resolved.attrs };
    }

    const needsSrc = kind === "js-src" || kind === "css-href";
    const needsCode = kind === "js-inline" || kind === "css-inline";
    if (needsSrc && !src) continue;
    if (needsCode && !code) continue;

    out.push({
      id: row.siriusId ?? row.id,
      slot,
      kind,
      src,
      code,
      attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
      order: row.ordering ?? impl.order ?? 100,
    });
  }

  out.sort((a, b) => a.order - b.order);

  return {
    head: out.filter((e) => e.slot === "head"),
    bodyEnd: out.filter((e) => e.slot === "bodyEnd"),
  };
}

import type { Request } from "express";
import { PluginRegistry } from "../_core";
import type {
  ClientInjectionPlugin,
  ClientInjectionManifestEntry,
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

export async function resolveClientInjections(
  req: Request,
): Promise<ResolvedInjectionManifest> {
  const enabled = await clientInjectionRegistry.listVisibleTo(req);

  const out: ResolvedInjection[] = [];
  for (const p of enabled) {
    let src = p.src;
    let code = p.code;
    let attrs = p.attrs;

    if (p.resolve) {
      const resolved = await p.resolve({ req, env: process.env });
      if (resolved === null || resolved === undefined) continue;
      if (resolved.src !== undefined) src = resolved.src;
      if (resolved.code !== undefined) code = resolved.code;
      if (resolved.attrs !== undefined) attrs = { ...(attrs ?? {}), ...resolved.attrs };
    }

    const needsSrc = p.kind === "js-src" || p.kind === "css-href";
    const needsCode = p.kind === "js-inline" || p.kind === "css-inline";
    if (needsSrc && !src) continue;
    if (needsCode && !code) continue;

    out.push({
      id: p.id,
      slot: p.slot,
      kind: p.kind,
      src,
      code,
      attrs,
      order: p.order ?? 100,
    });
  }

  out.sort((a, b) => a.order - b.order);

  return {
    head: out.filter((e) => e.slot === "head"),
    bodyEnd: out.filter((e) => e.slot === "bodyEnd"),
  };
}

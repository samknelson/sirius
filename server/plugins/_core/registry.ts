import type { Request } from "express";
import { logger } from "../../logger";
import type { BasePluginMetadata } from "./types";
import {
  isPluginComponentEnabledSync,
  isPluginComponentEnabledAsync,
  isPluginVisibleToUser,
} from "./gating";

/**
 * Generic plugin registry. The base layer owns: registration, lookup,
 * listing, component gating, access-policy gating, and a normalized
 * manifest-entry shape. Domain-specific behaviour (evaluate, runContent,
 * execute, getEligibilityCondition, …) stays on the kind-specific
 * plugin interface, not on the registry.
 *
 * The registry is generic over the plugin shape so kinds that store
 * metadata flat on the plugin object (dashboard, dispatch eligibility)
 * and kinds that nest metadata under `.metadata` (charge, trust
 * eligibility) can both share this scaffolding. The constructor takes
 * a `getMetadata` extractor and a `toManifestEntry` formatter.
 */
export class PluginRegistry<TPlugin, TEntry = BasePluginMetadata> {
  private plugins = new Map<string, TPlugin>();

  constructor(
    private readonly options: {
      kind: string;
      getMetadata: (plugin: TPlugin) => BasePluginMetadata;
      toManifestEntry: (plugin: TPlugin) => TEntry;
      /** When true, register() overwrites existing entries with a warn log. Otherwise it throws. */
      allowOverwrite?: boolean;
    },
  ) {}

  register(plugin: TPlugin): void {
    const meta = this.options.getMetadata(plugin);
    const existing = this.plugins.get(meta.id);
    if (existing) {
      if (this.options.allowOverwrite) {
        logger.warn(
          `Plugin '${meta.id}' (kind=${this.options.kind}) already registered, overwriting`,
          { service: "plugin-registry" },
        );
      } else {
        throw new Error(
          `Plugin '${meta.id}' (kind=${this.options.kind}) is already registered`,
        );
      }
    }
    this.plugins.set(meta.id, plugin);
  }

  get(id: string): TPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): TPlugin[] {
    return Array.from(this.plugins.values());
  }

  listIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  getMetadata(plugin: TPlugin): BasePluginMetadata {
    return this.options.getMetadata(plugin);
  }

  /**
   * Synchronously filter plugins whose required component is enabled.
   * Relies on the component cache being warm.
   */
  listEnabledSync(): TPlugin[] {
    return this.list().filter((p) => isPluginComponentEnabledSync(this.options.getMetadata(p)));
  }

  /**
   * Async variant. Useful where the component cache may not yet be warm.
   */
  async listEnabledAsync(): Promise<TPlugin[]> {
    const out: TPlugin[] = [];
    for (const p of this.list()) {
      if (await isPluginComponentEnabledAsync(this.options.getMetadata(p))) {
        out.push(p);
      }
    }
    return out;
  }

  /**
   * Returns plugins that pass BOTH component gating AND the per-user
   * access policy filter. Used by the unified manifest endpoint.
   */
  async listVisibleTo(req: Request): Promise<TPlugin[]> {
    const enabled = await this.listEnabledAsync();
    const visible: TPlugin[] = [];
    for (const p of enabled) {
      const result = await isPluginVisibleToUser(this.options.getMetadata(p), req);
      if (result.ok) visible.push(p);
    }
    return visible;
  }

  /**
   * Build the manifest entry for a single plugin via the kind-supplied
   * formatter.
   */
  toManifestEntry(plugin: TPlugin): TEntry {
    return this.options.toManifestEntry(plugin);
  }

  isEnabledSync(id: string): boolean {
    const p = this.get(id);
    if (!p) return false;
    return isPluginComponentEnabledSync(this.options.getMetadata(p));
  }

  async isEnabledAsync(id: string): Promise<boolean> {
    const p = this.get(id);
    if (!p) return false;
    return isPluginComponentEnabledAsync(this.options.getMetadata(p));
  }
}

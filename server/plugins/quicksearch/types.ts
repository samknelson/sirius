import type { JsonSchema } from "@shared/json-schema-form";
import type { User } from "@shared/schema";
import type { QuicksearchResult } from "@shared/quicksearch";
import type { storage as storageType } from "../../storage";
import type { BasePluginMetadata } from "../_core";

export type { QuicksearchResult };

export interface QuicksearchUiSchema {
  [key: string]: any;
}

/**
 * What a searcher is handed for one search. Everything access-related has
 * already been decided by the runner: the configuration's roles matched the
 * user's, the plugin's component and policy gates passed, and any
 * permission-gated option the user may not use has been forced off in
 * {@link settings}. A searcher never re-derives permission from the input.
 */
export interface QuicksearchContext {
  /** The query, trimmed. Never shorter than QUICKSEARCH_MIN_QUERY_LENGTH. */
  query: string;
  /**
   * Hard cap on rows to return. Ask the database for `limit + 1` so the
   * runner can report the group as truncated.
   */
  limit: number;
  /** The effective (masquerade-aware) user running the search. */
  user: User;
  /**
   * The configuration's `data`, after the runner has stripped every option the
   * user lacks the permission for (see {@link QuicksearchPlugin.permissionGatedOptions}).
   */
  settings: Record<string, unknown>;
  /** The owning `plugin_configs` row id. */
  configId: string;
  storage: typeof storageType;
}

/**
 * One record type a user can search from anywhere.
 *
 * A searcher decides for itself which of its clauses the typed string could
 * plausibly be and drops the rest — this is deliberately NOT a fixed OR across
 * every configured field. Typing `008` must not pull in every identifier
 * beginning `008`, and typing `2026` must not return every grievance filed
 * this year.
 */
export interface QuicksearchPlugin extends BasePluginMetadata {
  /**
   * Lucide icon name drawn beside this searcher's group heading (e.g.
   * "users"). The dialog resolves it from a small allowlist and falls back to
   * a generic icon for anything it does not know.
   */
  icon?: string;
  /** JSON Schema for the per-config settings. May be async (dynamic options). */
  settingsSchema?: JsonSchema | (() => Promise<JsonSchema>);
  /** RJSF companion to {@link settingsSchema}. May be async. */
  uiSchema?: QuicksearchUiSchema | (() => Promise<QuicksearchUiSchema>);
  /**
   * Settings keys whose "on" state additionally requires a permission, mapped
   * to the permission key that grants it.
   *
   * The RUNNER enforces this, not the plugin: before `search` is called, any
   * listed key the user lacks the permission for is forced to `false` in
   * `ctx.settings`. That keeps a sensitive clause (worker SSN) from depending
   * on a plugin author remembering to check, and makes the refusal uniform and
   * testable in one place.
   */
  permissionGatedOptions?: Record<string, string>;
  /** Find matching records. Read-only; must never write. */
  search(ctx: QuicksearchContext): Promise<QuicksearchResult[]>;
}

/** Manifest entry shape for quicksearch plugins. */
export interface QuicksearchManifestEntry {
  id: string;
  name: string;
  description: string;
  icon?: string;
  requiredComponent?: string;
  requiredPolicy?: string;
  hidden?: boolean;
  needsReadOnlyDb?: boolean;
  /** Whether the plugin has per-config settings at all. */
  hasSettings: boolean;
  /** Resolved settings schema, attached by the kind's `decorateEntries`. */
  configSchema?: JsonSchema;
  /** Resolved RJSF uiSchema companion to `configSchema`. */
  uiSchema?: QuicksearchUiSchema;
}

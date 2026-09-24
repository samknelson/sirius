import type { Request, Response } from "express";
import type { BasePluginMetadata } from "../_core";
import type { PluginConfig } from "@shared/schema";

/**
 * HTTP verbs a web service operation may declare. The dispatcher refuses any
 * verb an operation does not list, so this is the full set a plugin can pick
 * from.
 */
export const WEB_SERVICE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type WebServiceMethod = (typeof WEB_SERVICE_METHODS)[number];

/**
 * Everything an operation handler is given. The `config` is the SAME resolved
 * `plugin_configs` row the dispatcher already used for the grant check and the
 * enabled checks — a handler must never re-resolve the configuration from the
 * URL (that split would be a confused-deputy: authorized against one record,
 * executed against another).
 */
export interface WebServiceOperationContext {
  /** The resolved configuration row this call was addressed to. */
  config: PluginConfig;
  /** The configuration's editable settings blob (`plugin_configs.data`). */
  settings: Record<string, unknown>;
  req: Request;
  res: Response;
}

/**
 * One callable operation of a web service plugin. The `name` is a public URL
 * segment (`/api/ws/<configuration>/<name>`), so it is part of the plugin's
 * contract with its callers and must not be renamed casually.
 */
export interface WebServiceOperation {
  /** URL segment naming this operation. Lowercase, `[a-z0-9_.-]`. */
  name: string;
  /** Verbs this operation accepts. Anything else is refused by the dispatcher. */
  methods: WebServiceMethod[];
  /** Human description shown on the admin configuration + client test screens. */
  description: string;
  /**
   * JSON Schema for the JSON request body this operation accepts, for the
   * generated API document.
   *
   * Optional, and deliberately so: it is documentation, never enforcement —
   * the handler remains the only thing that validates a request. An operation
   * that declares nothing is published as "payload not described" rather than
   * with a guessed shape, because a wrong schema is worse than an absent one.
   * Only meaningful for the body-bearing verbs; a GET's query string is
   * described in {@link description}.
   */
  requestSchema?: Record<string, unknown>;
  /** JSON Schema for the success response body. Same optional-documentation rules as {@link requestSchema}. */
  responseSchema?: Record<string, unknown>;
  /** Runs the operation and writes the response. */
  handler: (ctx: WebServiceOperationContext) => Promise<void> | void;
}

/**
 * A web service plugin: a named set of callable operations. Each
 * `plugin_configs` row of kind `web-service` naming this plugin is one
 * independently enable-able, individually addressable web service exposing
 * exactly these operations.
 */
export interface WebServicePlugin extends BasePluginMetadata {
  /** Sort order on admin listings (lower first). Defaults to 100. */
  order?: number;
  /** JSON Schema for this plugin's per-configuration settings (`data`). */
  configSchema?: Record<string, unknown>;
  /** RJSF ui:schema for {@link configSchema}. */
  uiSchema?: Record<string, unknown>;
  /** The operations this plugin exposes. At least one is required. */
  operations: WebServiceOperation[];
}

/** Manifest entry shape served by `GET /api/plugins/web-service/manifest`. */
export interface WebServiceManifestEntry {
  id: string;
  name: string;
  description: string;
  order: number;
  requiredComponent?: string;
  /** Set by `decorateEntries` from the plugin's config rows. */
  enabled?: boolean;
  configSchema?: Record<string, unknown>;
  uiSchema?: Record<string, unknown>;
  /** Declared operations, without their handlers. */
  operations: {
    name: string;
    methods: WebServiceMethod[];
    description: string;
    requestSchema?: Record<string, unknown>;
    responseSchema?: Record<string, unknown>;
  }[];
}

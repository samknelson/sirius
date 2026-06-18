import type { Request } from "express";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";

export type InjectionSlot = "head" | "bodyEnd";
export type InjectionKind = "js-src" | "js-inline" | "css-href" | "css-inline";

/**
 * Editable per-row settings stored in `plugin_configs.data` for a
 * client-injection config. Every field is optional: the resolver merges these
 * over the registered impl's static defaults, so an admin can override the
 * slot/kind/src/code/attrs (e.g. for the custom CSS/JS injections) while a
 * component-owned impl (e.g. Weglot) can ship sane defaults and leave the row
 * `data` empty.
 */
export interface ClientInjectionData {
  slot?: InjectionSlot;
  kind?: InjectionKind;
  src?: string;
  code?: string;
  attrs?: Record<string, string | boolean>;
}

export interface ClientInjectionResolveContext {
  req: Request;
  env: NodeJS.ProcessEnv;
}

export interface ClientInjectionResolved {
  src?: string;
  code?: string;
  attrs?: Record<string, string | boolean>;
}

export interface ClientInjectionPlugin {
  id: string;
  name: string;
  description?: string;
  requiredComponent?: string;
  requiredPolicy?: string;
  hidden?: boolean;
  slot: InjectionSlot;
  kind: InjectionKind;
  order?: number;
  attrs?: Record<string, string | boolean>;
  src?: string;
  code?: string;
  /**
   * JSON Schema describing the editable `data` fields the generic admin UI
   * renders for a config row of this impl. Omit for impls whose output is
   * fully computed (e.g. Weglot init resolves its code from the API key).
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;
  resolve?: (
    ctx: ClientInjectionResolveContext,
  ) =>
    | Promise<ClientInjectionResolved | null>
    | ClientInjectionResolved
    | null;
}

export interface ClientInjectionManifestEntry {
  id: string;
  name: string;
  description?: string;
  slot: InjectionSlot;
  kind: InjectionKind;
  order: number;
  requiredComponent?: string;
  /** Attached by the kind's `decorateEntries` for the generic admin UI. */
  enabled?: boolean;
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
}

export interface ResolvedInjection {
  id: string;
  slot: InjectionSlot;
  kind: InjectionKind;
  src?: string;
  code?: string;
  attrs?: Record<string, string | boolean>;
  order: number;
}

export interface ResolvedInjectionManifest {
  head: ResolvedInjection[];
  bodyEnd: ResolvedInjection[];
}

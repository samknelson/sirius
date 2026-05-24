import type { Request } from "express";

export type InjectionSlot = "head" | "bodyEnd";
export type InjectionKind = "js-src" | "js-inline" | "css-href" | "css-inline";

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
  slot: InjectionSlot;
  kind: InjectionKind;
  order: number;
  requiredComponent?: string;
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

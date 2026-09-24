import type { Request } from "express";
import { isComponentEnabledSync } from "../../services/component-cache";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import type { BasePluginMetadata } from "./types";

/**
 * `modules/components` is a route module that reaches back into storage and
 * the plugin registries, so importing it at the top of this file closes a
 * module-initialization cycle (`_core/registry` → gating → components →
 * storage → wizards → `_core`). Node's ESM loader tolerates it; Vite's SSR
 * transform, which the test runner uses, resolves the barrel to `undefined`
 * mid-cycle. Every use here is already async, so a lazy import is free.
 */
async function isComponentEnabled(componentId: string): Promise<boolean> {
  const { isComponentEnabled: check } = await import("../../modules/components");
  return check(componentId);
}

/**
 * Single source of truth for component gating. Every plugin kind funnels
 * through this so the rule lives in one place. The sync variant is used
 * inside registry filters that already run after the component cache is
 * warm; the async variant is used at request boundaries that may run
 * before warm-up (extra-safe path).
 */
export function isPluginComponentEnabledSync(meta: BasePluginMetadata): boolean {
  if (!meta.requiredComponent) return true;
  return isComponentEnabledSync(meta.requiredComponent);
}

export async function isPluginComponentEnabledAsync(
  meta: BasePluginMetadata,
): Promise<boolean> {
  if (!meta.requiredComponent) return true;
  return isComponentEnabled(meta.requiredComponent);
}

/**
 * Per-user access-policy gate. Used at HTTP request boundaries (manifest
 * filter, /content front-door, write-edge enforcers).
 */
export async function isPluginVisibleToUser(
  meta: BasePluginMetadata,
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (meta.requiredPolicy) {
    const result = await checkAccessInline(req, meta.requiredPolicy);
    if (!result.granted) {
      return { ok: false, status: 403, message: result.reason || "Access denied" };
    }
  }
  return { ok: true };
}

/**
 * Combined gating used by every kind-specific authoritative check
 * (dashboard /content, charge admin writes, dispatch admin writes,
 * trust admin writes). Centralizing here ensures the same precedence
 * (component → policy) is applied consistently.
 */
export async function enforcePluginGating(
  meta: BasePluginMetadata,
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (meta.requiredComponent) {
    const enabled = await isComponentEnabled(meta.requiredComponent);
    if (!enabled) {
      return {
        ok: false,
        status: 403,
        message: `Component '${meta.requiredComponent}' not enabled`,
      };
    }
  }
  return isPluginVisibleToUser(meta, req);
}

/**
 * Kind-level gating used by the unified manifest endpoint. Mirrors
 * `enforcePluginGating` but takes the kind's component/policy gates
 * directly rather than reading them off a plugin's metadata.
 */
export async function enforceKindGating(
  opts: { requiredComponent?: string; requiredPolicy?: string },
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (opts.requiredComponent) {
    const enabled = await isComponentEnabled(opts.requiredComponent);
    if (!enabled) {
      return {
        ok: false,
        status: 403,
        message: `Component '${opts.requiredComponent}' not enabled`,
      };
    }
  }
  return isPluginVisibleToUser({ id: "", name: "", description: "", requiredPolicy: opts.requiredPolicy }, req);
}

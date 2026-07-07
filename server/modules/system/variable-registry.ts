import type { Request } from "express";
import { z } from "zod";
import type { InsertVariable } from "@shared/schema";
import { TERMINOLOGY_VARIABLE_NAME, terminologySchema, TERM_REGISTRY } from "@shared/terminology";
import { buildContext, checkAccess } from "../../services/access-policy-evaluator";
import { isComponentEnabled } from "../components";
import { dispatchEbaSettingsSchema } from "../dispatch/eba-config";
import { dispatchSeniorityResetSettingsSchema } from "../dispatch/seniority-reset-config";
import { dispatchDncNotificationConfigSchema } from "../dispatch/dnc-config";
import { workerBanNotificationConfigSchema } from "../worker-ban-config";
import { invalidateTerminologyCache, loadTerminology } from "../terminology";

/**
 * Unified per-variable registry.
 *
 * One entry per known variable governs BOTH directions of the generic
 * variable routes:
 *
 * - `readTier`: access required to READ the variable
 *   (GET /api/variables/by-name/:name and GET /api/variables/:id).
 *   "public" is served with no session; anything else is an
 *   access-policy id (e.g. "authenticated", "staff", "admin").
 *   Unlisted variables default to "admin", exactly as before.
 * - `writeTier`: access-policy id required to WRITE the variable
 *   (PUT/DELETE /api/variables/by-name/:name, and value validation on
 *   the id-based admin routes). Never "public"; defaults to "admin".
 * - `component`: optional component gate applied to both read and write.
 * - `schema`: optional zod schema for the variable's VALUE, enforced on
 *   every write through the generic routes (by-name and by-id).
 *   Unlisted or schema-less variables accept any value.
 * - `onWrite`: optional hook run after a successful write or delete
 *   (e.g. server-side cache invalidation).
 */
export interface VariableRegistryEntry {
  readTier?: "public" | string;
  writeTier?: string;
  component?: string;
  schema?: z.ZodTypeAny;
  onWrite?: () => void | Promise<void>;
}

/** Terminology value: only registered term keys, both forms trimmed+required. */
const terminologyValueSchema = terminologySchema.transform((terms) => {
  const valid: Record<string, { singular: string; plural: string }> = {};
  for (const [key, form] of Object.entries(terms)) {
    if (key in TERM_REGISTRY) {
      valid[key] = {
        singular: form.singular.trim(),
        plural: form.plural.trim(),
      };
    }
  }
  return valid;
});

const VARIABLE_REGISTRY: Record<string, VariableRegistryEntry> = {
  // Staff-readable, gated by the grievance component (deadline coloring)
  "grievance.deadline_thresholds": { readTier: "staff", component: "grievance" },

  // Dispatch-owned settings (component-gated in both directions)
  dispatch_eba_settings: {
    readTier: "authenticated",
    component: "dispatch",
    schema: dispatchEbaSettingsSchema,
  },
  dispatch_seniority_reset_settings: {
    component: "dispatch",
    schema: dispatchSeniorityResetSettingsSchema.transform((v) => ({
      triggerStatuses: Array.from(new Set(v.triggerStatuses)),
    })),
  },
  dispatch_dnc_notifications: {
    component: "dispatch",
    schema: dispatchDncNotificationConfigSchema,
  },

  // Worker ban notification settings (admin read/write)
  worker_ban_notifications: { schema: workerBanNotificationConfigSchema },

  // Fully public — needed by logged-out pages (login screen, header badge)
  system_mode: { readTier: "public", schema: z.enum(["dev", "test", "live"]) },
  site_name: { readTier: "public", schema: z.string() },
  site_title: { readTier: "public", schema: z.string().max(50) },
  site_footer: { readTier: "public", schema: z.string() },
  [TERMINOLOGY_VARIABLE_NAME]: {
    readTier: "public",
    schema: terminologyValueSchema,
    onWrite: async () => {
      invalidateTerminologyCache();
      await loadTerminology();
    },
  },
};

export function getVariableRegistryEntry(name: string): VariableRegistryEntry | undefined {
  return VARIABLE_REGISTRY[name];
}

export type VariableAccessDecision =
  | { granted: true }
  | { granted: false; status: 401 | 403; message: string };

async function checkTier(
  req: Request,
  tier: string,
  component: string | undefined,
): Promise<VariableAccessDecision> {
  if (tier !== "public") {
    // Auth first so unauthenticated callers always get 401, even when a
    // required component is disabled.
    const context = await buildContext(req);
    if (!context.user) {
      return { granted: false, status: 401, message: "Authentication required" };
    }

    if (component && !(await isComponentEnabled(component))) {
      return { granted: false, status: 403, message: "Access denied" };
    }

    const result = await checkAccess(tier, context.user);
    if (!result.granted) {
      return { granted: false, status: 403, message: "Access denied" };
    }
    return { granted: true };
  }

  if (component && !(await isComponentEnabled(component))) {
    return { granted: false, status: 403, message: "Access denied" };
  }
  return { granted: true };
}

/**
 * Decide whether the current request may READ the variable with the given
 * name. Unlisted names default to the admin policy.
 * 401 = no session where one is required; 403 = insufficient access or
 * required component disabled.
 */
export async function checkVariableReadAccess(
  req: Request,
  name: string,
): Promise<VariableAccessDecision> {
  const entry = VARIABLE_REGISTRY[name];
  return checkTier(req, entry?.readTier ?? "admin", entry?.component);
}

/**
 * Decide whether the current request may WRITE (or delete) the variable
 * with the given name. Writes are never public; unlisted names and
 * entries without a writeTier default to the admin policy.
 */
export async function checkVariableWriteAccess(
  req: Request,
  name: string,
): Promise<VariableAccessDecision> {
  const entry = VARIABLE_REGISTRY[name];
  const tier = entry?.writeTier ?? "admin";
  return checkTier(req, tier === "public" ? "admin" : tier, entry?.component);
}

/** Storage-compatible value type for the jsonb `variables.value` column. */
export type VariableJsonValue = InsertVariable["value"];

export type VariableValueValidation =
  | { ok: true; value: VariableJsonValue }
  | { ok: false; errors: z.ZodIssue[] };

/**
 * Validate a value against the registry schema for the given variable
 * name. Variables without a registered schema accept any value.
 */
export function validateVariableValue(name: string, value: unknown): VariableValueValidation {
  const entry = VARIABLE_REGISTRY[name];
  if (!entry?.schema) {
    return { ok: true, value: value as VariableJsonValue };
  }
  const result = entry.schema.safeParse(value);
  if (!result.success) {
    return { ok: false, errors: result.error.errors };
  }
  return { ok: true, value: result.data as VariableJsonValue };
}

/** Run the variable's onWrite hook (if any) after a successful write/delete. */
export async function runVariableOnWrite(name: string): Promise<void> {
  await VARIABLE_REGISTRY[name]?.onWrite?.();
}

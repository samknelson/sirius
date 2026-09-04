import type { Request } from "express";
import { z } from "zod";
import type { InsertVariable } from "@shared/schema";
import { TERMINOLOGY_VARIABLE_NAME, terminologySchema, TERM_REGISTRY } from "@shared/terminology";
import { APPEAL_WORKFLOW_VARIABLE, appealWorkflowSettingsSchema } from "@shared/schema";
import { buildContext, checkAccess } from "../../services/access-policy-evaluator";
import { isComponentEnabled } from "../components";
import { dispatchEbaSettingsSchema } from "../dispatch/eba-config";
import { dispatchSeniorityResetSettingsSchema } from "../dispatch/seniority-reset-config";
import { dispatchDncNotificationConfigSchema } from "../dispatch/dnc-config";
import { workerBanNotificationConfigSchema } from "../worker-ban-config";
import { entityFilesConfigSchema } from "../../services/entity-files/config";
import { authSettingsSchema } from "../../auth/auth-settings";
import {
  isEnvironmentVariableSecret,
  ENV_RELEASE_SENTINEL,
} from "../../config/env-registry";
import { invalidateTerminologyCache, loadTerminology } from "../terminology";
import { sanitizeHtml } from "@shared/utils/html";
import {
  TIMEZONE_POLICY_VARIABLE_NAME,
  timeZonePolicySchema,
} from "@shared/utils/timezone";

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
  /**
   * Optional server-side redaction applied to the variable's VALUE on every
   * generic read (list, by-id, by-name) before it leaves the server. Use for
   * variables whose value can embed secrets (e.g. env_overrides).
   */
  redactRead?: (value: unknown) => unknown;
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

  // BAO appeal workflow settings: initial (Submitted) status + default
  // timeline template applied to every new appeal. Staff-readable so the
  // intake form can surface configuration problems; admin-written through
  // the Variables UI. Gated by the BAO component that turns on the
  // appeal-only surface.
  [APPEAL_WORKFLOW_VARIABLE]: {
    readTier: "staff",
    component: "sitespecific.bao",
    schema: appealWorkflowSettingsSchema,
  },

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

  // Teamsters 631: member-status option IDs to sync (admin read/write,
  // gated by the sitespecific.t631.client component). Stored by option ID
  // so renaming a status does not lose the selection.
  "sitespecific.t631.ms_to_sync": {
    component: "sitespecific.t631.client",
    schema: z.array(z.string()).transform((ids) => Array.from(new Set(ids))),
  },

  // Worker ban notification settings (admin read/write)
  worker_ban_notifications: { schema: workerBanNotificationConfigSchema },

  // Auth settings: provisioning modes + SAML role mappings (admin read/write).
  // Role existence is additionally validated by PUT /api/admin/auth-settings.
  auth_settings: { schema: authSettingsSchema },


  // Entity file attachments framework: per-context {file_system, directory,
  // allowed?} map (admin read/write). Validated against the registered
  // contexts (unknown ids / unknown directory tokens are rejected).
  entity_files_config: { schema: entityFilesConfigSchema },

  // Worker TOS absence banner HTML (any authenticated user can read,
  // staff can write; gated by the worker.tos component)
  "worker.tos.absent_banner": {
    readTier: "authenticated",
    writeTier: "staff",
    component: "worker.tos",
    schema: z.string(),
  },

  // Fully public — needed by logged-out pages (login screen, header badge)
  system_mode: {
    readTier: "public",
    schema: z.enum(["dev", "test", "live", "maintenance"]),
    // Refresh the in-memory maintenance flag (and recycle idle pool
    // connections) after a system_mode write commits. Dynamic import to
    // avoid a module cycle with the storage layer.
    onWrite: async () => {
      const { refreshMaintenanceFlag } = await import("../../services/maintenance-mode");
      await refreshMaintenanceFlag();
    },
  },
  site_name: { readTier: "public", schema: z.string() },
  site_title: { readTier: "public", schema: z.string().max(50) },
  site_footer: { readTier: "public", schema: z.string() },
  login_page_title: { readTier: "public", schema: z.string() },
  // Defense in depth: sanitize at write time so raw API submissions can't
  // persist unsafe markup; the client also sanitizes before rendering.
  login_page_intro: {
    readTier: "public",
    schema: z
      .string()
      .transform((html) => (html ? sanitizeHtml(html, "rich-document") : html)),
  },
  [TERMINOLOGY_VARIABLE_NAME]: {
    readTier: "public",
    schema: terminologyValueSchema,
    onWrite: async () => {
      invalidateTerminologyCache();
      await loadTerminology();
    },
  },

  // Site policy for personal time zones. Any authenticated user may read it
  // because it is half of the decision every date display makes (the other
  // half is their own zone); admins write it.
  //
  // Turning it OFF genuinely changes what people see rather than just hiding
  // the picker: the resolver ignores a stored personal zone entirely, so a
  // site that declares "everyone works in site time" gets that, instead of
  // leaving previously saved choices quietly in force.
  [TIMEZONE_POLICY_VARIABLE_NAME]: {
    readTier: "authenticated",
    schema: timeZonePolicySchema,
  },

  // Selected main-menu plugin id (Site Configuration → Main menu).
  // Any authenticated user may read it; admins write it. The /api/menu
  // resolver falls back to "default" for unset/unknown values.
  site_menu_plugin: { readTier: "authenticated", schema: z.string() },
};

/**
 * Per-variable environment overrides: any variables row named `ENV_{NAME}`
 * stores the in-app override for env variable NAME (owner design, Task
 * #1096). Admin read/write. The value must be a non-empty string that is
 * not the release sentinel; there is NO restriction on WHICH names may be
 * overridden — precedence rules alone decide whether the override applies
 * (a real, non-empty, non-__UNSET__ process-env value always wins).
 */
const ENV_OVERRIDE_ROW_PREFIX = "ENV_";

function buildEnvOverrideEntry(rowName: string): VariableRegistryEntry {
  const envName = rowName.slice(ENV_OVERRIDE_ROW_PREFIX.length);
  return {
    // Values may hold secrets (e.g. ENV_SENDGRID_API_KEY): redact generic
    // reads when the underlying env declaration is marked secret. Unknown
    // (unregistered) names are redacted defensively.
    redactRead: (value) =>
      isEnvironmentVariableSecret(envName) ? "[redacted]" : value,
    schema: z
      .string()
      .min(1, "An override value must be a non-empty string")
      .refine((v) => v !== ENV_RELEASE_SENTINEL, {
        message: "The release sentinel cannot be stored as an override",
      }),
    onWrite: async () => {
      const { refreshEnvOverrides } = await import("../../services/env-overrides");
      await refreshEnvOverrides();
    },
  };
}

function resolveEntry(name: string): VariableRegistryEntry | undefined {
  const entry = VARIABLE_REGISTRY[name];
  if (entry) return entry;
  if (name.startsWith(ENV_OVERRIDE_ROW_PREFIX) && name.length > ENV_OVERRIDE_ROW_PREFIX.length) {
    return buildEnvOverrideEntry(name);
  }
  return undefined;
}

export function getVariableRegistryEntry(name: string): VariableRegistryEntry | undefined {
  return resolveEntry(name);
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
  const entry = resolveEntry(name);
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
  const entry = resolveEntry(name);
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
  const entry = resolveEntry(name);
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
/**
 * Apply the registry's per-variable read redaction (if any) to a variable
 * record before returning it from any generic read endpoint.
 */
export function redactVariableForRead<T extends { name: string; value: unknown }>(variable: T): T {
  const entry = resolveEntry(variable.name);
  if (!entry?.redactRead) return variable;
  return { ...variable, value: entry.redactRead(variable.value) };
}

export async function runVariableOnWrite(name: string): Promise<void> {
  await resolveEntry(name)?.onWrite?.();
}

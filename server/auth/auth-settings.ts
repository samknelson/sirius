import { z } from "zod";
import type { IStorage } from "../storage";

/**
 * Auth settings: one zod-validated JSON value in a single `variables` row.
 *
 * - `provisioning`: per-provider mode for external providers. "reject"
 *   (default) preserves today's behavior: an unmatched login is turned
 *   away. "create" auto-provisions an active local account on first login.
 * - `samlRoleMappings`: SAML attribute → role rules, reconciled on every
 *   SAML login. `value: null` means "attribute present with any value".
 */
export const AUTH_SETTINGS_VARIABLE = "auth_settings";

/** Providers that support auto-provisioning (never local). */
export const PROVISIONABLE_PROVIDERS = ["saml", "clerk", "replit", "okta", "oauth"] as const;
export type ProvisionableProvider = (typeof PROVISIONABLE_PROVIDERS)[number];

const provisioningModeSchema = z.enum(["reject", "create"]);
export type ProvisioningMode = z.infer<typeof provisioningModeSchema>;

export const samlRoleMappingSchema = z.object({
  /** SAML assertion attribute name (e.g. "groups", "department"). */
  attribute: z.string().trim().min(1),
  /** Expected value; null = any non-empty value counts as a match. */
  value: z.string().trim().min(1).nullable().default(null),
  /** Role id to grant while the mapping matches. */
  roleId: z.string().trim().min(1),
});
export type SamlRoleMapping = z.infer<typeof samlRoleMappingSchema>;

export const authSettingsSchema = z.object({
  provisioning: z
    .record(z.enum(PROVISIONABLE_PROVIDERS), provisioningModeSchema)
    .default({}),
  samlRoleMappings: z.array(samlRoleMappingSchema).default([]),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  provisioning: {},
  samlRoleMappings: [],
};

/** Read settings with safe defaults; malformed values fall back to defaults. */
export async function getAuthSettings(storage: IStorage): Promise<AuthSettings> {
  const variable = await storage.variables.getByName(AUTH_SETTINGS_VARIABLE);
  if (!variable) return DEFAULT_AUTH_SETTINGS;
  const parsed = authSettingsSchema.safeParse(variable.value);
  return parsed.success ? parsed.data : DEFAULT_AUTH_SETTINGS;
}

export function getProvisioningMode(
  settings: AuthSettings,
  provider: string,
): ProvisioningMode {
  const mode = (settings.provisioning as Record<string, ProvisioningMode>)[provider];
  return mode ?? "reject";
}

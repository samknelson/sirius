import type { Request } from "express";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import type { WizardPlugin } from "./types";

/**
 * Maps a wizard plugin's `entityType` to the "*.mine" access policy that
 * scopes it to the owning entity's users. Only entity-typed wizards are
 * scoped this way; a plugin with no `entityType` (e.g. an admin import
 * tool) is NOT entity-scoped here and keeps whatever plugin-level gating
 * its metadata declares.
 */
const ENTITY_MINE_POLICY: Record<string, string> = {
  employer: "employer.mine",
};

/**
 * Generic entity-scoped authorization for framework wizards. This mirrors
 * the legacy per-wizard checks (`admin` OR `employer.mine` on the wizard's
 * entityId) so migrating an employer-scoped wizard into the plugin
 * framework keeps the exact same authorization surface — the plugin-level
 * component/policy gate alone does NOT scope a wizard to one employer.
 *
 * Call this ONLY when `plugin.entityType` is set, so non-entity wizards are
 * unaffected. Admins always pass.
 */
export async function enforceWizardEntityAccess(
  plugin: WizardPlugin,
  entityId: string | null | undefined,
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const admin = await checkAccessInline(req, "admin");
  if (admin.granted) return { ok: true };

  const policy = plugin.entityType
    ? ENTITY_MINE_POLICY[plugin.entityType]
    : undefined;
  if (!policy) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  if (!entityId) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  const scoped = await checkAccessInline(req, policy, entityId);
  if (!scoped.granted) {
    return { ok: false, status: 403, message: scoped.reason || "Access denied" };
  }
  return { ok: true };
}

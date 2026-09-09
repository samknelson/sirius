import type { Request } from "express";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import type { WizardPlugin } from "./types";
import { wizardPluginRegistry } from "./registry";
import { storage } from "../../storage";

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

export type WizardAccessDecision =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * The sole ownership decision for persisted wizards. Context routes, file
 * downloads, and wizard routes supply their policy evaluator to this function
 * so they cannot drift in either the policy selected or fail-closed behavior.
 */
export async function checkWizardRecordAccess(
  wizardId: string,
  check: (policy: string, entityId?: string) => Promise<boolean>,
  componentEnabled: (componentId: string) => Promise<boolean>,
): Promise<WizardAccessDecision> {
  const wizard = await storage.wizards.getById(wizardId);
  if (!wizard) return { ok: false, status: 404, message: "Wizard not found" };
  const plugin = wizardPluginRegistry.get(wizard.type);
  if (!plugin) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  if (plugin.requiredComponent &&
      !(await componentEnabled(plugin.requiredComponent))) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  if (await check("admin")) return { ok: true };

  // Plugin-level policy and entity ownership are cumulative gates.
  if (plugin.requiredPolicy &&
      !(await check(plugin.requiredPolicy))) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  if (!plugin.entityType) {
    return plugin.requiredPolicy
      ? { ok: true }
      : { ok: false, status: 403, message: "Access denied" };
  }
  if (!wizard.entityId) return { ok: false, status: 403, message: "Access denied" };
  const policy = plugin.entityAccessPolicy ?? ENTITY_MINE_POLICY[plugin.entityType];
  if (!policy || !(await check(policy, wizard.entityId))) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  return { ok: true };
}

export async function enforceWizardRecordAccess(
  wizardId: string,
  req: Request,
): Promise<WizardAccessDecision> {
  return checkWizardRecordAccess(wizardId, async (policy, entityId) =>
    (await checkAccessInline(req, policy, entityId)).granted,
    async (componentId) => {
      const { isComponentEnabled } = await import("../../modules/components");
      return isComponentEnabled(componentId);
    },
  );
}

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
): Promise<WizardAccessDecision> {
  const admin = await checkAccessInline(req, "admin");
  if (admin.granted) return { ok: true };

  const policy =
    plugin.entityAccessPolicy ??
    (plugin.entityType ? ENTITY_MINE_POLICY[plugin.entityType] : undefined);
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

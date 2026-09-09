import type { Request } from "express";
import { storage } from "../storage";
import { buildContext, checkAccess } from "../services/access-policy-evaluator";
import { checkWizardRecordAccess } from "../plugins/wizards/entity-access";
import { isComponentEnabled } from "./components";
import {
  registerEntityFileContext,
  type EntityFileContext,
} from "../services/entity-files/registry";

/**
 * Registrations for the generic entity-files framework.
 *
 * Every registration here is a code registration only: attachment rows live
 * in the shared `entity_files` table keyed by the context id, and the
 * directory token `:entity-id` is framework-supplied. Adding a fifth area is
 * another entry in this file plus operator configuration under
 * Config → Entity Files — no table, no migration, no storage namespace.
 */

/**
 * Both access callbacks for a staff-only area. `checkAccess` gates the
 * /api/entity-files routes; `checkPolicyAccess` gates file downloads through
 * the `file.read` policy. They MUST stay exactly as strict as each other,
 * which is why they are built here as a pair rather than declared twice.
 */
function staffOnly(): Pick<EntityFileContext, "checkAccess" | "checkPolicyAccess"> {
  return {
    async checkAccess(_verb, _entityId, req: Request): Promise<boolean> {
      const context = await buildContext(req);
      const result = await checkAccess("staff", context.user);
      return result.granted;
    },
    async checkPolicyAccess(_verb, _entityId, ctx): Promise<boolean> {
      return ctx.checkPolicy("staff");
    },
  };
}

export function registerEntityFileContexts(): void {
  registerEntityFileContext({
    id: "wizard",
    label: "Wizards",
    recordLabel: "Wizard",
    async entityExists(id) { return Boolean(await storage.wizards.getById(id)); },
    async checkAccess(_verb, id, req) {
      const context = await buildContext(req);
      return (await checkWizardRecordAccess(id, async (policy, entityId) =>
        (await checkAccess(policy, context.user, entityId)).granted,
        (componentId) => isComponentEnabled(componentId))).ok;
    },
    async checkPolicyAccess(_verb, id, ctx) {
      return (await checkWizardRecordAccess(id, (policy, entityId) =>
        ctx.checkPolicy(policy, entityId),
        (componentId) => ctx.isComponentEnabled(componentId))).ok;
    },
  });
  // Grievances — staff-only, and gated on the `grievance` component.
  registerEntityFileContext({
    id: "grievance",
    label: "Grievances",
    recordLabel: "Grievance",
    component: "grievance",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.grievances.get(entityId));
    },
    ...staffOnly(),
  });

  // Workers — staff-only, matching the worker Notes/Logs tabs.
  registerEntityFileContext({
    id: "worker",
    label: "Workers",
    recordLabel: "Worker",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.workers.getWorker(entityId));
    },
    ...staffOnly(),
  });

  // Employers — staff-only, matching the employer Notes/Logs tabs.
  registerEntityFileContext({
    id: "employer",
    label: "Employers",
    recordLabel: "Employer",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.employers.getEmployer(entityId));
    },
    ...staffOnly(),
  });

  // Trust providers — staff-only, and hidden while `trust.providers` is off.
  registerEntityFileContext({
    id: "trust_provider",
    label: "Trust Providers",
    recordLabel: "Trust Provider",
    component: "trust.providers",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.trustProviders.getTrustProvider(entityId));
    },
    ...staffOnly(),
  });
}

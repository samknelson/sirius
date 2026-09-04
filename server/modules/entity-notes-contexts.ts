import type { Request } from "express";
import { storage } from "../storage";
import { buildContext, checkAccess } from "../services/access-policy-evaluator";
import {
  registerEntityNoteContext,
  type EntityNoteContext,
} from "../services/entity-notes/registry";

/**
 * Registrations for the generic entity-notes framework — the twin of
 * server/modules/entity-files-contexts.ts.
 *
 * Every registration here is a code registration only: note rows live in the
 * shared `entity_notes` table keyed by the context id. Adding a fifth area is
 * another entry in this file, one line in the table map used by the orphan
 * sweep (server/storage/entity-notes-context-tables.ts), and switching it on
 * under Config → Entity Notes — no table, no migration, no storage namespace.
 */

/** The access callback for a staff-only area; gates the /api/entity-notes routes. */
function staffOnly(): Pick<EntityNoteContext, "checkAccess"> {
  return {
    async checkAccess(_verb, _entityId, req: Request): Promise<boolean> {
      const context = await buildContext(req);
      const result = await checkAccess("staff", context.user);
      return result.granted;
    },
  };
}

export function registerEntityNoteContexts(): void {
  // Workers — staff-only.
  registerEntityNoteContext({
    id: "worker",
    label: "Workers",
    recordLabel: "Worker",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.workers.getWorker(entityId));
    },
    ...staffOnly(),
  });

  // Employers — staff-only.
  registerEntityNoteContext({
    id: "employer",
    label: "Employers",
    recordLabel: "Employer",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.employers.getEmployer(entityId));
    },
    ...staffOnly(),
  });

  // Trust providers — staff-only, and hidden while `trust.providers` is off.
  registerEntityNoteContext({
    id: "trust_provider",
    label: "Trust Providers",
    recordLabel: "Trust Provider",
    component: "trust.providers",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.trustProviders.getTrustProvider(entityId));
    },
    ...staffOnly(),
  });

  // Grievances — staff-only, and gated on the `grievance` component.
  registerEntityNoteContext({
    id: "grievance",
    label: "Grievances",
    recordLabel: "Grievance",
    component: "grievance",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.grievances.get(entityId));
    },
    ...staffOnly(),
  });
}

import type { Request } from "express";
import { storage } from "../storage";
import { workers, employers, trustProviders } from "@shared/schema";
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
 * shared `entity_notes` table keyed by the context id. Adding another area is
 * another registration (here, or in a component's startup) naming its table
 * for the orphan sweep, and switching it on under Config → Entity Notes — no table, no migration, no storage namespace.
 */

/** The access callback for a staff-only area; gates the /api/entity-notes routes. */
export function staffOnly(): Pick<EntityNoteContext, "checkAccess" | "checkAccessForUser"> {
  const checkAccessForUser: NonNullable<EntityNoteContext["checkAccessForUser"]> =
    async (_verb, _entityId, user) => (await checkAccess("staff", user)).granted;
  return {
    checkAccessForUser,
    async checkAccess(_verb, _entityId, req: Request): Promise<boolean> {
      const context = await buildContext(req);
      return checkAccessForUser(_verb, _entityId, context.user);
    },
  };
}

export function registerEntityNoteContexts(): void {
  // Workers — staff-only.
  registerEntityNoteContext({
    id: "worker",
    table: workers,
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
    table: employers,
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
    table: trustProviders,
    label: "Trust Providers",
    recordLabel: "Trust Provider",
    component: "trust.providers",
    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.trustProviders.getTrustProvider(entityId));
    },
    ...staffOnly(),
  });
}

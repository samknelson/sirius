import type { Request } from "express";
import type { User } from "@shared/schema";
import { isComponentEnabled } from "../modules/components";
import { storage } from "../storage";
import { buildContext, checkAccess } from "./access-policy-evaluator";
import {
  recordGoAccessRequirement,
  resolveRecordGoSource,
  presentRecordGo,
  type RecordGoResolution,
} from "./record-go";
import { getEntityNoteContext } from "./entity-notes/registry";
import { resolveEntityContextAvailability } from "../modules/entity-contexts";
import type { RecordGoPresentation } from "@shared/utils/record-go";

type ResolvedRecordGo = Extract<RecordGoResolution, { kind: "resolved" }>;

/**
 * Authorize the same record context that the destination detail route uses.
 * Relationship-backed records must first be translated to the parent entity
 * expected by their access policy.
 */
export async function authorizeRecordGoRequest(
  req: Request,
  resolution: ResolvedRecordGo,
): Promise<boolean> {
  const context = await buildContext(req);
  return authorizeRecordGoUser(context.user, resolution);
}

/**
 * Authorize a resolved record for a caller that is already represented by its
 * effective user. Quicksearch has no Express request, but it must enforce the
 * same context, component, permission, and relationship checks as /go before
 * revealing that an identifier resolves to a record.
 */
export async function authorizeRecordGoUser(
  user: User | null,
  resolution: ResolvedRecordGo,
): Promise<boolean> {
  const requirement = recordGoAccessRequirement(resolution.metadata.contextId);
  if (!requirement) return false;
  if (requirement.componentId && !(await isComponentEnabled(requirement.componentId))) {
    return false;
  }
  if (requirement.kind === "permission"
    && (!user || !(await storage.users.userHasPermission(user.id, requirement.id)))) return false;

  if (resolution.metadata.contextId === "entity_notes") {
    const parent = resolution.parent;
    if (!parent?.workerId || parent.noteContextId !== "worker") return false;
    const availability = await resolveEntityContextAvailability({
      framework: "entity-notes", contextId: parent.noteContextId,
    });
    if (!availability.available) return false;
    const notesContext = getEntityNoteContext(parent.noteContextId);
    if (!notesContext?.checkAccessForUser) return false;
    return await notesContext.checkAccessForUser("view", parent.workerId, user)
      && await notesContext.entityExists(parent.workerId)
      && (await checkAccess("worker.view", user, parent.workerId)).granted;
  }
  if (resolution.metadata.contextId === "worker_skills") {
    const workerId = resolution.parent?.workerId;
    if (!workerId || !(await storage.workers.getWorker(workerId))) return false;
    return (await checkAccess("worker.view", user, workerId)).granted;
  }

  if (requirement.kind === "permission") {
    return true;
  }

  let entityId = resolution.metadata.entityId;
  if (resolution.metadata.contextId === "employer_contacts") {
    const employerContact = await storage.employerContacts.get(entityId);
    entityId = employerContact?.employerId ?? "";
  } else if (resolution.metadata.contextId === "dispatches") {
    const dispatch = await storage.dispatches.get(entityId);
    entityId = dispatch?.workerId ?? "";
  } else if (resolution.metadata.contextId === "wizards") {
    const wizard = await storage.wizards.getById(entityId);
    if (!wizard) return false;
    const adminAccess = await checkAccess("admin", user);
    if (adminAccess.granted) return true;
    entityId = wizard.entityId ?? "";
  }
  if (!entityId) return false;

  const result = await checkAccess(requirement.id, user, entityId);
  return result.granted;
}

/** A missing or unauthorized origin must not reveal even its label. */
export async function presentAuthorizedRecordGoSource(
  user: User | null, entityType: string, entityId: string,
): Promise<RecordGoPresentation | null> {
  const resolution = await resolveRecordGoSource(entityType, entityId);
  if (resolution.kind !== "resolved" || !(await authorizeRecordGoUser(user, resolution))) return null;
  return presentRecordGo(resolution);
}

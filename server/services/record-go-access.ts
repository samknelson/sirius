import type { Request } from "express";
import type { User } from "@shared/schema";
import { isComponentEnabled } from "../modules/components";
import { storage } from "../storage";
import { buildContext, checkAccess } from "./access-policy-evaluator";
import {
  recordGoAccessRequirement,
  type RecordGoResolution,
} from "./record-go";

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

  if (requirement.kind === "permission") {
    return !!user && await storage.users.userHasPermission(user.id, requirement.id);
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

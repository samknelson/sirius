import type { Request } from "express";
import { isComponentEnabled } from "../modules/components";
import { storage } from "../storage";
import { buildContext, checkAccessInline } from "./access-policy-evaluator";
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
  const requirement = recordGoAccessRequirement(resolution.metadata.contextId);
  if (!requirement) return false;
  if (requirement.componentId && !(await isComponentEnabled(requirement.componentId))) {
    return false;
  }

  if (requirement.kind === "permission") {
    const context = await buildContext(req);
    return !!context.user
      && await storage.users.userHasPermission(context.user.id, requirement.id);
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
    const adminAccess = await checkAccessInline(req, "admin");
    if (adminAccess.granted) return true;
    entityId = wizard.entityId ?? "";
  }
  if (!entityId) return false;

  const result = await checkAccessInline(req, requirement.id, entityId);
  return result.granted;
}
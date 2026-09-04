import type { Express, NextFunction, Request, Response } from "express";
import {
  addBaoCaseNoteRequestSchema,
  approveBaoAppealRequestSchema,
  createBaoCaseRequestSchema,
  denyBaoAppealRequestSchema,
  listBaoCasesQuerySchema,
  updateBaoCaseRequestSchema,
  TRUST_EXEMPTION_SOURCE_BAO_APPEAL,
  type TrustBenefitEligibilityExemptionView,
} from "@shared/schema";
import { storage } from "../../../storage";
import { isComponentEnabled, requireComponent } from "../../components";
import { getEffectiveUser } from "../../masquerade";
import {
  assignmentForbidden,
  BAO_CASE_ASSIGN_PERMISSION,
} from "../../../storage/sitespecific/bao/case-assignment";
import { approveAppeal, denyAppeal, EXEMPTIONS_COMPONENT_ID, listExemptionChecks } from "../../../services/sitespecific/bao/appeal-outcomes";
import { TrustBenefitEligibilityExemptionValidationError } from "../../../storage/trust/eligibility-exemptions";

type Middleware = (req: Request, res: Response, next: NextFunction) => any;
type AccessMiddleware = (policy: string) => Middleware;

async function effectiveUserId(req: Request): Promise<string | null> {
  const { dbUser } = await getEffectiveUser((req as any).session ?? {}, (req as any).user);
  return dbUser?.id ?? null;
}

/**
 * The exemptions this case's approval granted, found through the provenance
 * each exemption row records (`data.source` naming this case) — never through
 * the id the approval stored on the appeal details, so deleting an exemption
 * later simply drops it from this list instead of showing a dangling id. Null
 * when the exemptions component is off: its table may not exist, and "none"
 * would be a claim this deployment cannot make.
 */
async function grantedExemptionsOf(caseId: string): Promise<TrustBenefitEligibilityExemptionView[] | null> {
  if (!(await isComponentEnabled(EXEMPTIONS_COMPONENT_ID))) return null;
  return storage.trustBenefitEligibilityExemptions.listBySource({
    kind: TRUST_EXEMPTION_SOURCE_BAO_APPEAL,
    caseId,
  });
}

function caseError(res: Response, error: any) {
  const messages: Record<string, [number, string]> = {
    ENTITY_NOT_FOUND: [404, "Entity not found"],
    NOTE_NOT_FOUND: [404, "Note not found"],
    CASE_NOT_FOUND: [404, "BAO case not found"],
    INVALID_ASSIGNEE: [400, "Assignee must be an active staff user"],
    INVALID_STATUS: [400, "Unknown BAO case status"],
    INITIAL_STATUS_CLOSED: [400, "A new case must start in an open status"],
    INVALID_RESOLUTION: [400, "Unknown BAO case resolution"],
    INVALID_NOTE_TYPE: [400, "The note type does not apply to this entity"],
    NOTE_ENTITY_MISMATCH: [409, "The note belongs to a different entity"],
    RESOLUTION_REQUIRED: [409, "Closing a case requires a resolution and resolution date"],
    OPEN_CASE_RESOLUTION: [409, "An open case cannot retain resolution information"],
    ASSIGN_OTHERS_FORBIDDEN: [403, "You can only assign BAO cases to yourself"],
    CASE_TYPE_STATUS_MISMATCH: [409, "The selected status does not belong to this case type"],
    OUTREACH_NOTE_REQUIRED: [409, "Closing this case requires a member-outreach note"],
    INVALID_INITIAL_WORKFLOW_STEP: [409, "Benefit Appeal cases must start in Submitted"],
    APPEAL_WORKER_REQUIRED: [400, "Benefit Appeal cases must be about a worker"],
    APPEAL_DETAILS_REQUIRED: [400, "Benefit Appeal cases require a benefit and denial reason"],
    INVALID_APPEAL_DENIAL_REASON: [400, "Unknown appeal denial reason"],
    INVALID_APPEAL_BENEFIT: [400, "The selected benefit is not active"],
    APPEAL_AUTO_DENIED_STATUS_MISSING: [409, "Benefit Appeal workflow is missing its Auto-Denied status; ask an administrator to configure it"],
    INVALID_WORKFLOW_TRANSITION: [409, "That status is not the next step in this case workflow"],
    LETTER_WRONG_STATE: [409, "This appeal is not awaiting a member letter"],
    MEMBER_LETTER_ALREADY_RECORDED: [409, "A member letter has already been recorded"],
    CASE_DOCUMENT_NOT_FOUND: [404, "Case document not found"],
    TRUSTEE_REVIEW_STATUS_MISSING: [409, "Trustee Review is not configured"],
    OUTCOME_WRONG_STATE: [409, "Only a Benefit Appeal in Trustee Review can be approved or denied"],
    OUTCOME_STATUS_MISSING: [409, "The Benefit Appeal workflow is missing its outcome status; ask an administrator to configure it"],
    OUTCOME_STATUS_OPEN: [409, "The Benefit Appeal outcome status is not a closed status; ask an administrator to configure it"],
    OUTCOME_ACTION_REQUIRED: [409, "Use the Approve or Deny action to record a trustee outcome"],
    EXEMPTION_GRANT_REQUIRED: [500, "Approval did not supply an exemption grant"],
    EXEMPTION_CHECKS_REQUIRED: [400, "Select at least one eligibility check to exempt"],
    UNKNOWN_ELIGIBILITY_PLUGIN: [400, "One or more selected eligibility checks are not available"],
    EXEMPTIONS_COMPONENT_DISABLED: [409, "Approving an appeal requires the Eligibility Exemptions component to be enabled"],
  };
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    return res.status(409).json({ message: "This note already belongs to a BAO case" });
  }
  const mapped = messages[error?.message];
  if (mapped) {
    return res.status(mapped[0]).json({
      message: mapped[1],
      ...(error?.details !== undefined ? { details: error.details } : {}),
    });
  }
  if (error instanceof TrustBenefitEligibilityExemptionValidationError) {
    return res.status(400).json({ message: error.message, field: error.field });
  }
  if (error?.name === "ZodError") {
    return res.status(400).json({ message: "Invalid data", errors: error.errors });
  }
  console.error("BAO case request failed:", error);
  return res.status(500).json({ message: "BAO case request failed" });
}

export function registerBaoCaseRoutes(
  app: Express,
  requireAuth: Middleware,
  requireAccess: AccessMiddleware,
) {
  const gate = [requireAuth, requireComponent("sitespecific.bao"), requireAccess("staff")];

  // Assignee context: the pickable staff users PLUS the caller's assignment
  // capability, so the forms offer exactly what the server will accept.
  app.get("/api/sitespecific/bao/cases/assignees", ...gate, async (req, res) => {
    try {
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const [users, canAssignOthers] = await Promise.all([
        storage.users.getUsersWithAnyPermission(["staff", "admin"]),
        storage.users.userHasPermission(actor, BAO_CASE_ASSIGN_PERMISSION),
      ]);
      res.json({
        selfId: actor,
        canAssignOthers,
        users: users.filter((u) => u.isActive).map((u) => ({
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
          email: u.email,
        })),
      });
    } catch (error) {
      caseError(res, error);
    }
  });

  // Eligibility checks an appeal approval may waive. Literal path: it must
  // stay registered ahead of the /:id routes below.
  app.get("/api/sitespecific/bao/cases/appeal-checks", ...gate, (_req, res) => {
    res.json({ checks: listExemptionChecks() });
  });

  app.get("/api/sitespecific/bao/cases", ...gate, async (req, res) => {
    try {
      const parsed = listBaoCasesQuerySchema.parse(req.query);
      if ((parsed.entityType && !parsed.entityId) || (!parsed.entityType && parsed.entityId)) {
        return res.status(400).json({ message: "entityType and entityId must be provided together" });
      }
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const result = await storage.baoCases.list({
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        assigneeUserId: parsed.scope === "my" ? actor : undefined,
        caseTypeId: parsed.caseTypeId,
        closed: parsed.view === "historical",
        page: parsed.page,
        pageSize: parsed.pageSize,
        sort: parsed.sort,
        direction: parsed.direction,
      });
      res.json(result);
    } catch (error) {
      caseError(res, error);
    }
  });

  app.get("/api/sitespecific/bao/cases/by-note/:noteId", ...gate, async (req, res) => {
    try {
      const linked = await storage.baoCases.getByNoteId(req.params.noteId);
      res.json(linked ?? null);
    } catch (error) {
      caseError(res, error);
    }
  });

  app.get("/api/sitespecific/bao/cases/:id", ...gate, async (req, res) => {
    try {
      const record = await storage.baoCases.get(req.params.id, true);
      if (!record) return res.status(404).json({ message: "BAO case not found" });
      if (record.notes?.length) {
        const tags = await storage.baoNoteTags.listByNotes(record.notes.map((n) => n.id));
        const byNote = new Map<string, any[]>();
        for (const tag of tags) byNote.set(tag.noteId, [...(byNote.get(tag.noteId) ?? []), tag]);
        record.notes = record.notes.map((note) => ({ ...note, tags: byNote.get(note.id) ?? [] })) as any;
      }
      // The case's letter record (member notices linked to it), whether the
      // member even has an address to mail to — so an empty list can say WHY
      // nothing went out — and any exemption an approved appeal granted.
      const [letters, mailingAddressOnFile, grantedExemptions] = await Promise.all([
        storage.baoCases.listLetters(record.id),
        storage.baoCases.hasMailingAddress(record.id),
        grantedExemptionsOf(record.id),
      ]);
      res.json({ ...record, letters, mailingAddressOnFile, grantedExemptions });
    } catch (error) {
      caseError(res, error);
    }
  });

  app.post("/api/sitespecific/bao/cases", ...gate, async (req, res) => {
    try {
      const parsed = createBaoCaseRequestSchema.parse(req.body);
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      if (parsed.assigneeUserId && parsed.assigneeUserId !== actor) {
        const canAssignOthers = await storage.users.userHasPermission(actor, BAO_CASE_ASSIGN_PERMISSION);
        if (assignmentForbidden({
          requestedAssigneeId: parsed.assigneeUserId,
          actorUserId: actor,
          existingAssigneeId: null,
          canAssignOthers,
        })) {
          throw new Error("ASSIGN_OTHERS_FORBIDDEN");
        }
      }
      const created = await storage.baoCases.create({
        ...parsed,
        assigneeUserId: parsed.assigneeUserId ?? actor,
        actorUserId: actor,
      });
      res.status(201).json(created);
    } catch (error) {
      caseError(res, error);
    }
  });

  app.patch("/api/sitespecific/bao/cases/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateBaoCaseRequestSchema.parse(req.body);
      // The self-vs-other assignment rule is enforced by storage INSIDE the
      // row-locked lifecycle transaction (a pre-read here would race with a
      // concurrent reassignment); the route only resolves the actor context.
      // The actor is resolved for EVERY update (not just reassignments) so
      // the committed event can carry the effective acting user.
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const assignment = {
        actorUserId: actor,
        canAssignOthers: parsed.assigneeUserId
          ? await storage.users.userHasPermission(actor, BAO_CASE_ASSIGN_PERMISSION)
          : false,
      };
      const updated = await storage.baoCases.updateLifecycle(req.params.id, parsed, assignment);
      res.json(updated);
    } catch (error) {
      caseError(res, error);
    }
  });

  app.post("/api/sitespecific/bao/cases/:id/notes", ...gate, async (req, res) => {
    try {
      const parsed = addBaoCaseNoteRequestSchema.parse(req.body);
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const note = await storage.baoCases.addNote(req.params.id, parsed, actor);
      res.status(201).json(note);
    } catch (error) {
      caseError(res, error);
    }
  });
  app.post("/api/sitespecific/bao/cases/:id/member-letter", ...gate, async (req, res) => {
    try {
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const updated = await storage.baoCases.recordMemberLetter(req.params.id, req.body?.fileId, req.body?.note, actor);
      res.json(updated);
    } catch (error) { caseError(res, error); }
  });

  // Trustee outcomes on a Benefit Appeal in Trustee Review. The worker and
  // benefit the approval exempts come from the case row, never the body.
  app.post("/api/sitespecific/bao/cases/:id/approve", ...gate, async (req, res) => {
    try {
      const parsed = approveBaoAppealRequestSchema.parse(req.body);
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const result = await approveAppeal(req.params.id, { ...parsed, actorUserId: actor });
      res.json(result);
    } catch (error) { caseError(res, error); }
  });
  app.post("/api/sitespecific/bao/cases/:id/deny", ...gate, async (req, res) => {
    try {
      const parsed = denyBaoAppealRequestSchema.parse(req.body ?? {});
      const actor = await effectiveUserId(req);
      if (!actor) return res.status(401).json({ message: "Effective user not found" });
      const result = await denyAppeal(req.params.id, { ...parsed, actorUserId: actor });
      res.json(result);
    } catch (error) { caseError(res, error); }
  });
}

import type { Express, NextFunction, Request, Response } from "express";
import {
  addBaoCaseNoteRequestSchema,
  createBaoCaseRequestSchema,
  listBaoCasesQuerySchema,
  updateBaoCaseRequestSchema,
} from "@shared/schema";
import { storage } from "../../../storage";
import { requireComponent } from "../../components";
import { getEffectiveUser } from "../../masquerade";
import {
  assignmentForbidden,
  BAO_CASE_ASSIGN_PERMISSION,
} from "../../../storage/sitespecific/bao/case-assignment";

type Middleware = (req: Request, res: Response, next: NextFunction) => any;
type AccessMiddleware = (policy: string) => Middleware;

async function effectiveUserId(req: Request): Promise<string | null> {
  const { dbUser } = await getEffectiveUser((req as any).session ?? {}, (req as any).user);
  return dbUser?.id ?? null;
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
  };
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    return res.status(409).json({ message: "This note already belongs to a BAO case" });
  }
  const mapped = messages[error?.message];
  if (mapped) return res.status(mapped[0]).json({ message: mapped[1] });
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
      res.json(record);
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
      let assignment: { actorUserId: string; canAssignOthers: boolean } | undefined;
      if (parsed.assigneeUserId) {
        const actor = await effectiveUserId(req);
        if (!actor) return res.status(401).json({ message: "Effective user not found" });
        assignment = {
          actorUserId: actor,
          canAssignOthers: await storage.users.userHasPermission(actor, BAO_CASE_ASSIGN_PERMISSION),
        };
      }
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
}
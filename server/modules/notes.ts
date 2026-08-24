import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isComponentEnabled } from "./components";
import { getNoteEntityType, isNoteEntityType, noteEntityTypeLabel } from "@shared/notes";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const createNoteApiSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  typeId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
});

const updateNoteApiSchema = z.object({
  typeId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
});

/**
 * Guard an entity type: it must be registered in the shared note-entity
 * registry AND, when the record's pages belong to a component, that component
 * must be enabled. Returns an error payload or null.
 */
async function checkEntityType(
  entityType: string,
): Promise<{ status: number; message: string } | null> {
  if (!isNoteEntityType(entityType)) {
    return { status: 400, message: `Notes are not supported for "${entityType}"` };
  }
  const requiredComponent = getNoteEntityType(entityType)?.requiredComponent;
  if (requiredComponent && !(await isComponentEnabled(requiredComponent))) {
    return { status: 403, message: `Access denied: the feature that owns ${noteEntityTypeLabel(entityType)} records is not enabled` };
  }
  return null;
}

/**
 * Validate that a note type exists and applies to the given record type. The
 * dropdown already filters by record type, but a hand-made request must not be
 * able to pair a type with a record type it does not declare.
 */
async function checkNoteType(
  typeId: string,
  entityType: string,
): Promise<{ status: number; message: string } | null> {
  const optionsStorage = (await import("./options-registry")).getOptionsStorage();
  const noteType = await optionsStorage.get("note-type", typeId);
  if (!noteType) {
    return { status: 400, message: "Unknown note type" };
  }
  const entityTypes = (noteType.data as { entityTypes?: unknown } | null)?.entityTypes;
  const applies = Array.isArray(entityTypes) && entityTypes.includes(entityType);
  if (!applies) {
    return {
      status: 400,
      message: `Note type "${noteType.name}" does not apply to ${noteEntityTypeLabel(entityType)} records`,
    };
  }
  return null;
}

/**
 * Notes routes.
 *
 * Staff-only on every verb, reads included — notes are internal commentary and
 * a worker must not see their own. Every write re-checks the entity type
 * against the shared registry, that the parent record actually exists, and
 * that the chosen note type applies to that record type.
 */
export function registerNotesRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  app.get("/api/notes/:entityType/:entityId", requireAuth, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const typeError = await checkEntityType(entityType);
      if (typeError) {
        return res.status(typeError.status).json({ message: typeError.message });
      }
      const notes = await storage.notes.listByEntity(entityType, entityId);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.post("/api/notes", requireAuth, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = createNoteApiSchema.parse(req.body);

      const typeError = await checkEntityType(validated.entityType);
      if (typeError) {
        return res.status(typeError.status).json({ message: typeError.message });
      }
      if (!(await storage.notes.entityExists(validated.entityType, validated.entityId))) {
        return res.status(404).json({ message: `${noteEntityTypeLabel(validated.entityType)} not found` });
      }
      const noteTypeError = await checkNoteType(validated.typeId, validated.entityType);
      if (noteTypeError) {
        return res.status(noteTypeError.status).json({ message: noteTypeError.message });
      }

      // The masqueraded user is the actor of record everywhere, notes included.
      const { getEffectiveUser } = await import("./masquerade");
      const { dbUser } = await getEffectiveUser((req as any).session ?? {}, (req as any).user);

      const note = await storage.notes.create({
        entityType: validated.entityType,
        entityId: validated.entityId,
        typeId: validated.typeId,
        subject: validated.subject,
        body: validated.body ?? null,
        data: validated.data ?? null,
        userId: dbUser?.id ?? null,
      });
      res.status(201).json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", details: error.errors });
      }
      console.error("Error creating note:", error);
      res.status(500).json({ message: "Failed to create note" });
    }
  });

  app.put("/api/notes/:id", requireAuth, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = updateNoteApiSchema.parse(req.body);
      const existing = await storage.notes.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }

      // Gate on the note's OWN record type, not on anything the caller sends:
      // a note never moves between records.
      const typeError = await checkEntityType(existing.entityType);
      if (typeError) {
        return res.status(typeError.status).json({ message: typeError.message });
      }
      if (validated.typeId !== undefined) {
        const noteTypeError = await checkNoteType(validated.typeId, existing.entityType);
        if (noteTypeError) {
          return res.status(noteTypeError.status).json({ message: noteTypeError.message });
        }
      }

      const updates: Record<string, unknown> = {};
      if (validated.typeId !== undefined) updates.typeId = validated.typeId;
      if (validated.subject !== undefined) updates.subject = validated.subject;
      if (validated.body !== undefined) updates.body = validated.body;
      if (validated.data !== undefined) updates.data = validated.data;

      const note = await storage.notes.update(req.params.id, updates);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", details: error.errors });
      }
      console.error("Error updating note:", error);
      res.status(500).json({ message: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:id", requireAuth, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const existing = await storage.notes.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }
      const typeError = await checkEntityType(existing.entityType);
      if (typeError) {
        return res.status(typeError.status).json({ message: typeError.message });
      }
      const deleted = await storage.notes.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Note not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).json({ message: "Failed to delete note" });
    }
  });
}

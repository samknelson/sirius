import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { isComponentEnabled } from "./components";
import { resolveEntityContextAvailability } from "./entity-contexts";
import {
  getEntityNoteContext,
  listEntityNoteContexts,
  type EntityNoteContext,
  type EntityNotesVerb,
} from "../services/entity-notes/registry";
import { getEntityNotesContextConfig } from "../services/entity-notes/config";
import { logger } from "../logger";

type AuthMiddleware = (req: Request, res: Response, next: () => void) => void;

const createNoteApiSchema = z.object({
  contextId: z.string().min(1),
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

const BAO_COMPONENT = "sitespecific.bao";

const setNoteTagsApiSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(200),
});

function toTagPayload(row: {
  tagId: string;
  tagName: string;
  tagTypeId: string;
  tagTypeName: string | null;
  tagTypeSequence: number | null;
}) {
  return {
    id: row.tagId,
    name: row.tagName,
    tagTypeId: row.tagTypeId,
    tagTypeName: row.tagTypeName,
    tagTypeSequence: row.tagTypeSequence,
  };
}

/**
 * The ONE refusal for "this area does not take notes": unknown context or a
 * disabled component are indistinguishable 404s (no probing), an area an
 * operator has not switched on is a 403 that says so. Every verb goes through
 * here, including the two that address a note by id, so a note in an area that
 * was switched off can no longer be read, edited or deleted through the API —
 * matching the tab, which is hidden for exactly the same reason.
 */
async function resolveContext(
  contextId: string,
  res: Response,
): Promise<EntityNoteContext | undefined> {
  const availability = await resolveEntityContextAvailability({
    framework: "entity-notes",
    contextId,
  });
  if (!availability.available) {
    res.status(availability.status).json({ message: availability.reason });
    return undefined;
  }
  return getEntityNoteContext(contextId);
}

/** Context resolution plus the context's access callback and record existence. */
async function resolveContextAndAuthorize(
  req: Request,
  res: Response,
  contextId: string,
  entityId: string,
  verb: EntityNotesVerb,
): Promise<EntityNoteContext | undefined> {
  const context = await resolveContext(contextId, res);
  if (!context) return undefined;
  if (!(await context.checkAccess(verb, entityId, req))) {
    res.status(403).json({ message: "Insufficient permissions" });
    return undefined;
  }
  if (!(await context.entityExists(entityId))) {
    res.status(404).json({ message: `${context.recordLabel} not found` });
    return undefined;
  }
  return context;
}

/**
 * Validate that a note type exists and applies to the given context. The
 * dropdown already filters by record type, but a hand-made request must not be
 * able to pair a type with a record type it does not declare.
 */
async function checkNoteType(
  typeId: string,
  context: EntityNoteContext,
): Promise<{ status: number; message: string } | null> {
  const optionsStorage = (await import("./options-registry")).getOptionsStorage();
  const noteType = await optionsStorage.get("note-type", typeId);
  if (!noteType) {
    return { status: 400, message: "Unknown note type" };
  }
  const contextIds = (noteType.data as { contextIds?: unknown } | null)?.contextIds;
  const applies = Array.isArray(contextIds) && contextIds.includes(context.id);
  if (!applies) {
    return {
      status: 400,
      message: `Note type "${noteType.name}" does not apply to ${context.recordLabel} records`,
    };
  }
  return null;
}

/**
 * Generic entity notes routes.
 *
 * Which record types can carry notes is a code registration
 * (server/services/entity-notes/registry.ts); WHETHER an area carries them is
 * operator configuration in the `entity_notes_config` variable. Access is the
 * context's own callback — staff-only for every area today, reads included,
 * since notes are internal commentary a worker must not see about themselves.
 */
export function registerEntityNotesRoutes(app: Express, requireAuth: AuthMiddleware) {
  // Admin metadata for the config page: registered contexts and whether notes
  // are currently switched on for each. Registered before the `:context`
  // routes so "contexts" is never read as a context id.
  app.get(
    "/api/entity-notes/contexts",
    requireAuth,
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const contexts = await Promise.all(
          listEntityNoteContexts().map(async (context) => ({
            id: context.id,
            label: context.label,
            recordLabel: context.recordLabel,
            component: context.component ?? null,
            componentEnabled: context.component
              ? await isComponentEnabled(context.component)
              : true,
            enabled: (await getEntityNotesContextConfig(context.id)) !== undefined,
          })),
        );
        res.json({ contexts });
      } catch (error) {
        logger.error("Failed to list entity note contexts", {
          service: "entityNotes",
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to list entity note contexts" });
      }
    },
  );

  app.get(
    "/api/entity-notes/:context/:entityId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { context: contextId, entityId } = req.params;
        const context = await resolveContextAndAuthorize(req, res, contextId, entityId, "view");
        if (!context) return;

        const notes = await storage.entityNotes.listByEntity(context.id, entityId);

        // BAO-only enrichment: attach each note's tags (grouped/ordered by tag
        // type) and its case link. For non-BAO deployments the response shape
        // is unchanged.
        if (await isComponentEnabled(BAO_COMPONENT)) {
          const rows = await storage.baoNoteTags.listByNotes(notes.map((n) => n.id));
          const byNote = new Map<string, typeof rows>();
          for (const row of rows) {
            const list = byNote.get(row.noteId) ?? [];
            list.push(row);
            byNote.set(row.noteId, list);
          }
          const caseLinks = await storage.baoCases.getByNoteIds(notes.map((n) => n.id));
          return res.json(notes.map((n) => ({
            ...n,
            tags: (byNote.get(n.id) ?? []).map(toTagPayload),
            caseId: caseLinks.get(n.id) ?? null,
          })));
        }

        res.json(notes);
      } catch (error) {
        logger.error("Failed to list notes", {
          service: "entityNotes",
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to fetch notes" });
      }
    },
  );

  app.post("/api/entity-notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = createNoteApiSchema.parse(req.body);
      const context = await resolveContextAndAuthorize(
        req,
        res,
        validated.contextId,
        validated.entityId,
        "manage",
      );
      if (!context) return;

      const noteTypeError = await checkNoteType(validated.typeId, context);
      if (noteTypeError) {
        return res.status(noteTypeError.status).json({ message: noteTypeError.message });
      }

      // The masqueraded user is the actor of record everywhere, notes included.
      const { getEffectiveUser } = await import("./masquerade");
      const { dbUser } = await getEffectiveUser((req as any).session ?? {}, (req as any).user);

      const note = await storage.entityNotes.create({
        contextId: context.id,
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
      logger.error("Failed to create note", {
        service: "entityNotes",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to create note" });
    }
  });

  app.put("/api/entity-notes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateNoteApiSchema.parse(req.body);
      const existing = await storage.entityNotes.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }

      // Gate on the note's OWN context, not on anything the caller sends: a
      // note never moves between records.
      const context = await resolveContextAndAuthorize(
        req,
        res,
        existing.contextId,
        existing.entityId,
        "manage",
      );
      if (!context) return;

      if (validated.typeId !== undefined) {
        const noteTypeError = await checkNoteType(validated.typeId, context);
        if (noteTypeError) {
          return res.status(noteTypeError.status).json({ message: noteTypeError.message });
        }
      }

      const updates: Record<string, unknown> = {};
      if (validated.typeId !== undefined) updates.typeId = validated.typeId;
      if (validated.subject !== undefined) updates.subject = validated.subject;
      if (validated.body !== undefined) updates.body = validated.body;
      if (validated.data !== undefined) updates.data = validated.data;

      const note = await storage.entityNotes.update(req.params.id, updates);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", details: error.errors });
      }
      logger.error("Failed to update note", {
        service: "entityNotes",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to update note" });
    }
  });

  // Replace a note's tag set. BAO-only: 403 when the component is off (the
  // join and tag tables belong to it and are absent then). Same context
  // gate + access callback as the other note writes.
  app.put("/api/entity-notes/:id/tags", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isComponentEnabled(BAO_COMPONENT))) {
        return res.status(403).json({ message: "Access denied: note tagging requires the BAO feature to be enabled" });
      }
      const validated = setNoteTagsApiSchema.parse(req.body);
      const existing = await storage.entityNotes.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }
      const context = await resolveContextAndAuthorize(
        req,
        res,
        existing.contextId,
        existing.entityId,
        "manage",
      );
      if (!context) return;

      // Every id must be a real tag — a bad id must not vanish silently.
      const tagIds = Array.from(new Set(validated.tagIds));
      if (tagIds.length > 0) {
        const optionsStorage = (await import("./options-registry")).getOptionsStorage();
        const known = new Set((await optionsStorage.list("bao-notes-tag")).map((t: { id: string }) => t.id));
        const unknown = tagIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          return res.status(400).json({ message: `Unknown tag id(s): ${unknown.join(", ")}` });
        }
      }

      const rows = await storage.baoNoteTags.setForNote(req.params.id, tagIds);
      res.json(rows.map(toTagPayload));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", details: error.errors });
      }
      logger.error("Failed to set note tags", {
        service: "entityNotes",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to set note tags" });
    }
  });

  app.delete("/api/entity-notes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.entityNotes.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }
      const context = await resolveContextAndAuthorize(
        req,
        res,
        existing.contextId,
        existing.entityId,
        "manage",
      );
      if (!context) return;

      if (await isComponentEnabled(BAO_COMPONENT)) {
        const linked = await storage.baoCases.getByNoteId(existing.id);
        if (linked) {
          return res.status(409).json({
            message: "This note is part of a BAO case and cannot be deleted.",
          });
        }
      }
      const deleted = await storage.entityNotes.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Note not found" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete note", {
        service: "entityNotes",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to delete note" });
    }
  });
}

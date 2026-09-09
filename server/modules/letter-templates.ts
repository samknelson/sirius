import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  MEDIUM_FIELDS,
  MEDIUM_NAMES,
  isSafeRelativePath,
  type MediumName,
} from "@shared/delivery-fields";
import { extractTokenExpressions } from "@shared/tokens";
import { storage } from "../storage";
import {
  listTokenContexts,
  resolveTokenContextGate,
  tokenContextRootNames,
} from "../plugins/tokens/contexts";
import { validateTokenExpressionForRoots } from "../plugins/tokens";

type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => unknown;

const jsonObject = z.record(z.unknown());
const baseInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  medium: z.enum(MEDIUM_NAMES),
  contextIds: z.array(z.string().trim().min(1))
    .min(1, "Choose at least one token context")
    .refine((ids) => new Set(ids).size === ids.length, "Token contexts must be unique"),
  content: z.record(z.string()).default({}),
  siriusId: z.string().trim().min(1).nullable().optional(),
  data: jsonObject.default({}),
});
const createInput = baseInput;
const updateInput = baseInput.partial().refine(
  (input) => Object.keys(input).length > 0,
  "At least one field is required",
);
const listQuery = z.object({
  medium: z.enum(MEDIUM_NAMES).optional(),
  context_id: z.string().trim().min(1).optional(),
});

function validateContextIds(contextIds: string[]): string | undefined {
  const offered = new Set(
    listTokenContexts()
      .filter((context) => resolveTokenContextGate(context.id).ok)
      .map((context) => context.id),
  );
  const unknown = contextIds.find((id) => !offered.has(id));
  return unknown
    ? `This deployment offers no token context "${unknown}".`
    : undefined;
}

function validateContent(
  medium: MediumName,
  content: Record<string, string>,
  contextIds: string[],
): string | undefined {
  const allowed = new Set(MEDIUM_FIELDS[medium].map((field) => field.key));
  const unknown = Object.keys(content).find((key) => !allowed.has(key));
  if (unknown) return `The ${medium} medium has no authored field "${unknown}".`;

  if (
    medium === "inapp" &&
    content.linkUrl?.trim() &&
    !isSafeRelativePath(content.linkUrl.trim())
  ) {
    return 'The in-app link URL must be a relative path starting with "/" (not "//" or an absolute URL).';
  }

  for (const [field, value] of Object.entries(content)) {
    for (const expression of extractTokenExpressions(value)) {
      for (const contextId of contextIds) {
        const validation = validateTokenExpressionForRoots(
          expression,
          tokenContextRootNames(contextId),
        );
        if (!validation.ok) {
          return `${field}: {{${expression}}} is not valid in token context "${contextId}" — ${validation.error}`;
        }
      }
    }
  }
  return undefined;
}

function validationMessage(
  input: Partial<z.infer<typeof baseInput>>,
  current?: { medium: string; contextIds: string[]; content: unknown },
): string | undefined {
  const contextIds = input.contextIds ?? current?.contextIds;
  if (contextIds) {
    const contextError = validateContextIds(contextIds);
    if (contextError) return contextError;
  }
  const medium = (input.medium ?? current?.medium) as MediumName | undefined;
  const content = (input.content ?? current?.content) as
    | Record<string, string>
    | undefined;
  if (medium && content && contextIds) {
    return validateContent(medium, content, contextIds);
  }
  return undefined;
}

function isSiriusIdConflict(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string };
  return (
    pg?.code === "23505" &&
    pg.constraint === "letter_templates_sirius_id_unique"
  );
}

export function registerLetterTemplateRoutes(
  app: Express,
  requireAccess: (policy: string) => Middleware,
): void {
  const staff = requireAccess("staff");

  app.get("/api/admin/letter-templates", staff, async (req, res) => {
    try {
      const query = listQuery.parse(req.query);
      res.json(await storage.letterTemplates.getAll({
        medium: query.medium,
        contextId: query.context_id,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0]?.message ?? "Invalid letter template filters",
        });
      }
      console.error("Failed to list letter templates:", error);
      res.status(500).json({ message: "Failed to list letter templates" });
    }
  });

  app.post("/api/admin/letter-templates", staff, async (req, res) => {
    try {
      const input = createInput.parse(req.body);
      const problem = validationMessage(input);
      if (problem) return res.status(400).json({ message: problem });
      const created = await storage.letterTemplates.create({
        ...input,
        siriusId: input.siriusId ?? null,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0]?.message ?? "Invalid letter template",
        });
      }
      if (isSiriusIdConflict(error)) {
        return res.status(409).json({ message: "Sirius ID is already in use" });
      }
      console.error("Failed to create letter template:", error);
      res.status(500).json({ message: "Failed to create letter template" });
    }
  });

  app.get("/api/admin/letter-templates/:id", staff, async (req, res) => {
    try {
      const row = await storage.letterTemplates.get(req.params.id);
      if (!row) return res.status(404).json({ message: "Letter template not found" });
      res.json(row);
    } catch (error) {
      console.error("Failed to load letter template:", error);
      res.status(500).json({ message: "Failed to load letter template" });
    }
  });

  app.patch("/api/admin/letter-templates/:id", staff, async (req, res) => {
    try {
      const current = await storage.letterTemplates.get(req.params.id);
      if (!current) return res.status(404).json({ message: "Letter template not found" });
      const input = updateInput.parse(req.body);
      const problem = validationMessage(input, current);
      if (problem) return res.status(400).json({ message: problem });
      const updated = await storage.letterTemplates.update(req.params.id, input);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0]?.message ?? "Invalid letter template",
        });
      }
      if (isSiriusIdConflict(error)) {
        return res.status(409).json({ message: "Sirius ID is already in use" });
      }
      console.error("Failed to update letter template:", error);
      res.status(500).json({ message: "Failed to update letter template" });
    }
  });

  app.delete("/api/admin/letter-templates/:id", staff, async (req, res) => {
    try {
      const deleted = await storage.letterTemplates.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Letter template not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete letter template:", error);
      res.status(500).json({ message: "Failed to delete letter template" });
    }
  });
}
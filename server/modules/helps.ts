import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertHelpSchema } from "@shared/schema";
import { z } from "zod";
import DOMPurify from "isomorphic-dompurify";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

// Mirrors the tag/attribute whitelist of SimpleHtmlEditor
// (client/src/components/ui/simple-html-editor.tsx). Keep in sync.
const ALLOWED_TAGS = [
  "strong", "b", "em", "i", "u", "ul", "ol", "li", "br", "p", "a",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
];
const ALLOWED_ATTR = ["href", "target", "rel", "colspan", "rowspan", "scope"];

export function sanitizeHelpHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):|^[/#]|^[^:]*$/i,
  });
}

const updateHelpSchema = insertHelpSchema.partial();

function sanitizeDetails<T extends { details?: string | null }>(data: T): T {
  if (typeof data.details === "string") {
    return { ...data, details: sanitizeHelpHtml(data.details) };
  }
  return data;
}

export function registerHelpRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const adminOnly = requireAccess("admin");

  app.get("/api/helps", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.helps.getAll());
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch help entries" });
    }
  });

  // Lookup must be registered before /:id so "lookup" isn't captured as an id.
  app.get("/api/helps/lookup", requireAuth, async (req, res) => {
    try {
      const path = typeof req.query.path === "string" ? req.query.path : "";
      if (!path.startsWith("/")) {
        return res.status(400).json({ message: "path query parameter is required and must start with /" });
      }
      res.json(await storage.helps.findMatchingForPath(path));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to look up help entries" });
    }
  });

  app.get("/api/helps/:id", requireAuth, async (req, res) => {
    try {
      const help = await storage.helps.get(req.params.id);
      if (!help) return res.status(404).json({ message: "Help entry not found" });
      res.json(help);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch help entry" });
    }
  });

  app.post("/api/helps", requireAuth, adminOnly, async (req, res) => {
    try {
      const validated = sanitizeDetails(insertHelpSchema.parse(req.body));
      res.status(201).json(await storage.helps.create(validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to create help entry" });
    }
  });

  app.put("/api/helps/:id", requireAuth, adminOnly, async (req, res) => {
    try {
      const validated = sanitizeDetails(updateHelpSchema.parse(req.body));
      const updated = await storage.helps.update(req.params.id, validated);
      if (!updated) return res.status(404).json({ message: "Help entry not found" });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update help entry" });
    }
  });

  app.delete("/api/helps/:id", requireAuth, adminOnly, async (req, res) => {
    try {
      const deleted = await storage.helps.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Help entry not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete help entry" });
    }
  });
}

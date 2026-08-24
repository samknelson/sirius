import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertHelpSchema } from "@shared/schema";
import { z } from "zod";
import {
  findSystemHelpsForPath,
  getAllSystemHelps,
  getSystemHelp,
  isSystemHelpId,
} from "../help/system";
import { sanitizeHtml } from "@shared/utils/html";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateHelpSchema = insertHelpSchema.partial();

function sanitizeDetails<T extends { details?: string | null }>(data: T): T {
  if (typeof data.details === "string") {
    return { ...data, details: sanitizeHtml(data.details, "rich-document") };
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
      const dbEntries = (await storage.helps.getAll()).map((h) => ({ ...h, source: "config" as const }));
      res.json([...getAllSystemHelps(), ...dbEntries]);
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
      const dbMatches = (await storage.helps.findMatchingForPath(path)).map((h) => ({
        ...h,
        source: "config" as const,
      }));
      res.json([...dbMatches, ...findSystemHelpsForPath(path)]);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to look up help entries" });
    }
  });

  app.get("/api/helps/:id", requireAuth, async (req, res) => {
    try {
      if (isSystemHelpId(req.params.id)) {
        const systemHelp = getSystemHelp(req.params.id);
        if (!systemHelp) return res.status(404).json({ message: "Help entry not found" });
        return res.json(systemHelp);
      }
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
      if (isSystemHelpId(req.params.id)) {
        return res.status(403).json({ message: "System help entries are built into the application and cannot be edited." });
      }
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
      if (isSystemHelpId(req.params.id)) {
        return res.status(403).json({ message: "System help entries are built into the application and cannot be deleted." });
      }
      const deleted = await storage.helps.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Help entry not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete help entry" });
    }
  });
}

import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

const createContractSchema = z
  .object({
    name: z.string().trim().min(1, "Contract name is required"),
  })
  .strict();

const updateContractSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    stubSections: z.boolean().optional(),
  })
  .strict();

const createArticleSchema = z
  .object({
    name: z.string().trim().min(1, "Article name is required"),
    articleNumber: z.string().trim().optional(),
  })
  .strict();

const updateArticleSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    articleNumber: z
      .union([z.string().trim(), z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
  })
  .strict();

const createSectionSchema = z
  .object({
    name: z.string().trim().min(1, "Section name is required"),
    sectionNumber: z.string().trim().optional(),
    body: z.string().optional(),
    isStub: z.boolean().optional(),
  })
  .strict();

const updateSectionSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    sectionNumber: z
      .union([z.string().trim(), z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
    body: z.union([z.string(), z.null()]).optional(),
    isStub: z.boolean().optional(),
  })
  .strict();

const moveSchema = z
  .object({
    direction: z.enum(["up", "down"]),
  })
  .strict();

export function registerContractRoutes(
  app: Express,
  requireAuth: any,
  _requirePermission: any,
) {
  const contractComponent = requireComponent("contract");
  const gate = [contractComponent, requireAuth, requireAccess("staff")] as const;

  // ── Contracts ──
  app.get("/api/contracts", ...gate, async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const rows = await storage.contracts.list(search);
      res.json(rows);
    } catch (error) {
      console.error("Error listing contracts:", error);
      res.status(500).json({ message: "Failed to list contracts" });
    }
  });

  app.post("/api/contracts", ...gate, async (req, res) => {
    try {
      const parsed = createContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const created = await storage.contracts.createContract({ name: parsed.data.name });
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating contract:", error);
      res.status(500).json({ message: "Failed to create contract" });
    }
  });

  app.get("/api/contracts/:id", ...gate, async (req, res) => {
    try {
      const contract = await storage.contracts.getById(req.params.id);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      const counts = await storage.contracts.getCounts(contract.id);
      res.json({ ...contract, ...counts });
    } catch (error) {
      console.error("Error fetching contract:", error);
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  app.patch("/api/contracts/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const updated = await storage.contracts.update(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Contract not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating contract:", error);
      res.status(500).json({ message: "Failed to update contract" });
    }
  });

  app.delete("/api/contracts/:id", ...gate, async (req, res) => {
    try {
      const ok = await storage.contracts.delete(req.params.id);
      if (!ok) return res.status(404).json({ message: "Contract not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting contract:", error);
      res.status(500).json({ message: "Failed to delete contract" });
    }
  });

  // ── Articles ──
  app.get("/api/contracts/:id/articles", ...gate, async (req, res) => {
    try {
      const rows = await storage.contracts.listArticles(req.params.id);
      res.json(rows);
    } catch (error) {
      console.error("Error listing articles:", error);
      res.status(500).json({ message: "Failed to list articles" });
    }
  });

  app.post("/api/contracts/:id/articles", ...gate, async (req, res) => {
    try {
      const parsed = createArticleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const contract = await storage.contracts.getById(req.params.id);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      const existing = await storage.contracts.listArticles(req.params.id);
      const created = await storage.contracts.createArticle({
        contractId: req.params.id,
        name: parsed.data.name,
        articleNumber: parsed.data.articleNumber ?? null,
        sequence: existing.length,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating article:", error);
      res.status(500).json({ message: "Failed to create article" });
    }
  });

  app.get("/api/contracts/articles/:articleId", ...gate, async (req, res) => {
    try {
      const article = await storage.contracts.getArticle(req.params.articleId);
      if (!article) return res.status(404).json({ message: "Article not found" });
      res.json(article);
    } catch (error) {
      console.error("Error fetching article:", error);
      res.status(500).json({ message: "Failed to fetch article" });
    }
  });

  app.patch("/api/contracts/articles/:articleId", ...gate, async (req, res) => {
    try {
      const parsed = updateArticleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const updated = await storage.contracts.updateArticle(req.params.articleId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Article not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating article:", error);
      res.status(500).json({ message: "Failed to update article" });
    }
  });

  app.delete("/api/contracts/articles/:articleId", ...gate, async (req, res) => {
    try {
      const ok = await storage.contracts.deleteArticle(req.params.articleId);
      if (!ok) return res.status(404).json({ message: "Article not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting article:", error);
      res.status(500).json({ message: "Failed to delete article" });
    }
  });

  app.post("/api/contracts/articles/:articleId/move", ...gate, async (req, res) => {
    try {
      const parsed = moveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const article = await storage.contracts.getArticle(req.params.articleId);
      if (!article) return res.status(404).json({ message: "Article not found" });
      const rows = await storage.contracts.moveArticle(req.params.articleId, parsed.data.direction);
      res.json(rows);
    } catch (error) {
      console.error("Error moving article:", error);
      res.status(500).json({ message: "Failed to move article" });
    }
  });

  // ── Sections ──
  app.get("/api/contracts/articles/:articleId/sections", ...gate, async (req, res) => {
    try {
      const rows = await storage.contracts.listSections(req.params.articleId);
      res.json(rows);
    } catch (error) {
      console.error("Error listing sections:", error);
      res.status(500).json({ message: "Failed to list sections" });
    }
  });

  app.post("/api/contracts/articles/:articleId/sections", ...gate, async (req, res) => {
    try {
      const parsed = createSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const article = await storage.contracts.getArticle(req.params.articleId);
      if (!article) return res.status(404).json({ message: "Article not found" });
      const existing = await storage.contracts.listSections(req.params.articleId);
      const created = await storage.contracts.createSection({
        articleId: req.params.articleId,
        name: parsed.data.name,
        sectionNumber: parsed.data.sectionNumber ?? null,
        body: parsed.data.body ?? null,
        isStub: parsed.data.isStub ?? false,
        sequence: existing.length,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating section:", error);
      res.status(500).json({ message: "Failed to create section" });
    }
  });

  app.get("/api/contracts/sections/:sectionId", ...gate, async (req, res) => {
    try {
      const section = await storage.contracts.getSection(req.params.sectionId);
      if (!section) return res.status(404).json({ message: "Section not found" });
      res.json(section);
    } catch (error) {
      console.error("Error fetching section:", error);
      res.status(500).json({ message: "Failed to fetch section" });
    }
  });

  app.patch("/api/contracts/sections/:sectionId", ...gate, async (req, res) => {
    try {
      const parsed = updateSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const updated = await storage.contracts.updateSection(req.params.sectionId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Section not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating section:", error);
      res.status(500).json({ message: "Failed to update section" });
    }
  });

  app.delete("/api/contracts/sections/:sectionId", ...gate, async (req, res) => {
    try {
      const ok = await storage.contracts.deleteSection(req.params.sectionId);
      if (!ok) return res.status(404).json({ message: "Section not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting section:", error);
      res.status(500).json({ message: "Failed to delete section" });
    }
  });

  app.post("/api/contracts/sections/:sectionId/move", ...gate, async (req, res) => {
    try {
      const parsed = moveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
      }
      const section = await storage.contracts.getSection(req.params.sectionId);
      if (!section) return res.status(404).json({ message: "Section not found" });
      const rows = await storage.contracts.moveSection(req.params.sectionId, parsed.data.direction);
      res.json(rows);
    } catch (error) {
      console.error("Error moving section:", error);
      res.status(500).json({ message: "Failed to move section" });
    }
  });
}

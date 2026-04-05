import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertTrustProviderEdiSchema } from "../../shared/schema/trust/provider-edi-schema";
import { requireComponent } from "./components";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

export function registerTrustProviderEdiRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const ediComponent = requireComponent("trust.providers.edi");

  app.get("/api/trust-provider-edi", requireAuth, requireAccess('admin'), ediComponent, async (req, res) => {
    try {
      const providerId = req.query.providerId as string | undefined;
      const items = providerId
        ? await storage.trustProviderEdi.getByProviderId(providerId)
        : await storage.trustProviderEdi.getAll();
      res.json(items);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch trust provider EDI records";
      res.status(500).json({ message });
    }
  });

  app.get("/api/trust-provider-edi/:id", requireAuth, requireAccess('admin'), ediComponent, async (req, res) => {
    try {
      const item = await storage.trustProviderEdi.getById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Trust Provider EDI not found" });
      }
      res.json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch trust provider EDI record";
      res.status(500).json({ message });
    }
  });

  app.post("/api/trust-provider-edi", requireAuth, requireAccess('admin'), ediComponent, async (req, res) => {
    try {
      const parsed = insertTrustProviderEdiSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }
      const item = await storage.trustProviderEdi.create(parsed.data);
      res.status(201).json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create trust provider EDI record";
      res.status(500).json({ message });
    }
  });

  app.patch("/api/trust-provider-edi/:id", requireAuth, requireAccess('admin'), ediComponent, async (req, res) => {
    try {
      const parsed = insertTrustProviderEdiSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }
      const item = await storage.trustProviderEdi.update(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "Trust Provider EDI not found" });
      }
      res.json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update trust provider EDI record";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/trust-provider-edi/:id", requireAuth, requireAccess('admin'), ediComponent, async (req, res) => {
    try {
      const deleted = await storage.trustProviderEdi.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Trust Provider EDI not found" });
      }
      res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete trust provider EDI record";
      res.status(500).json({ message });
    }
  });
}

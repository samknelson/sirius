import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertSftpClientDestinationSchema } from "../../shared/schema/system/sftp-client-schema";
import { requireComponent } from "./components";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateSchema = insertSftpClientDestinationSchema.partial();

export function registerSftpClientDestinationRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const sftpComponent = requireComponent("system.sftp.client");

  app.get("/api/sftp/client-destinations", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const all = await storage.sftpClientDestinations.getAll();
      res.json(all);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch SFTP client destinations" });
    }
  });

  app.get("/api/sftp/client-destinations/:id", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id } = req.params;
      const dest = await storage.sftpClientDestinations.getById(id);
      if (!dest) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }
      res.json(dest);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch SFTP client destination" });
    }
  });

  app.post("/api/sftp/client-destinations", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const validated = insertSftpClientDestinationSchema.parse(req.body);

      if (validated.siriusId) {
        const existing = await storage.sftpClientDestinations.getBySiriusId(validated.siriusId);
        if (existing) {
          return res.status(400).json({ message: "An SFTP client destination with this Sirius ID already exists" });
        }
      }

      const created = await storage.sftpClientDestinations.create(validated);
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to create SFTP client destination" });
    }
  });

  app.put("/api/sftp/client-destinations/:id", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await storage.sftpClientDestinations.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }

      const validated = updateSchema.parse(req.body);

      if (validated.siriusId && validated.siriusId !== existing.siriusId) {
        const duplicate = await storage.sftpClientDestinations.getBySiriusId(validated.siriusId);
        if (duplicate) {
          return res.status(400).json({ message: "An SFTP client destination with this Sirius ID already exists" });
        }
      }

      const updated = await storage.sftpClientDestinations.update(id, validated);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update SFTP client destination" });
    }
  });

  app.delete("/api/sftp/client-destinations/:id", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await storage.sftpClientDestinations.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }

      await storage.sftpClientDestinations.delete(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete SFTP client destination" });
    }
  });
}

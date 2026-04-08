import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertSftpClientDestinationSchema, connectionDataSchema } from "../../shared/schema/system/sftp-client-schema";
import { requireComponent } from "./components";
import { z } from "zod";
import * as fileTransfer from "../services/file-transfer-client";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateSchema = insertSftpClientDestinationSchema.partial();

const testPathBody = z.object({ path: z.string().min(1, "path is required") });
const testOptionalPathBody = z.object({ path: z.string().optional() });
const testUploadBody = z.object({
  path: z.string().optional(),
  fileName: z.string().min(1, "fileName is required"),
  contentBase64: z.string().min(1, "contentBase64 is required"),
});

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

  app.put("/api/sftp/client-destinations/:id/connection", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await storage.sftpClientDestinations.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }

      const validated = connectionDataSchema.parse(req.body);

      const updated = await storage.sftpClientDestinations.update(id, { data: validated });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update connection data" });
    }
  });

  app.post("/api/sftp/client-destinations/:id/test/:action", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id, action } = req.params;
      const dest = await storage.sftpClientDestinations.getById(id);
      if (!dest) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }

      const parsed = connectionDataSchema.safeParse(dest.data);
      if (!parsed.success) {
        return res.status(400).json({ message: "No valid connection data configured for this destination" });
      }
      const conn = parsed.data;

      switch (action) {
        case "connect": {
          const result = await fileTransfer.testConnect(conn, id);
          return res.json(result);
        }
        case "list": {
          const body = testOptionalPathBody.parse(req.body);
          const remotePath = body.path || conn.homeDir || "/";
          const result = await fileTransfer.testList(conn, remotePath, id);
          return res.json(result);
        }
        case "cd": {
          const body = testPathBody.parse(req.body);
          const result = await fileTransfer.testCd(conn, body.path, id);
          return res.json(result);
        }
        case "upload": {
          const body = testUploadBody.parse(req.body);
          const buffer = Buffer.from(body.contentBase64, "base64");
          if (buffer.length > 1024 * 1024) {
            return res.status(400).json({ message: "File size must be under 1 MB" });
          }
          const result = await fileTransfer.testUpload(conn, body.path || conn.homeDir || "/", body.fileName, buffer, id);
          return res.json(result);
        }
        default:
          return res.status(400).json({ message: `Unknown test action: ${action}` });
      }
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      const message = error instanceof Error ? error.message : "Test operation failed";
      res.status(500).json({ message });
    }
  });

  app.get("/api/sftp/client-destinations/:id/test/download", requireAuth, requireAccess('admin'), sftpComponent, async (req, res) => {
    try {
      const { id } = req.params;
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ message: "path query parameter is required" });
      }

      const dest = await storage.sftpClientDestinations.getById(id);
      if (!dest) {
        return res.status(404).json({ message: "SFTP client destination not found" });
      }

      const parsed = connectionDataSchema.safeParse(dest.data);
      if (!parsed.success) {
        return res.status(400).json({ message: "No valid connection data configured for this destination" });
      }

      const pathLib = await import("path");
      const fileName = pathLib.basename(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Content-Type", "application/octet-stream");

      await fileTransfer.streamDownload(parsed.data, filePath, id, res);
    } catch (error: unknown) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : "Download failed";
        res.status(500).json({ message });
      } else if (!res.writableEnded) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
      }
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

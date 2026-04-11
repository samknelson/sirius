import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import {
  insertBulkMessageSchema,
  insertBulkMessagesEmailSchema,
  insertBulkMessagesSmsSchema,
  insertBulkMessagesPostalSchema,
  insertBulkMessagesInappSchema,
} from "../../shared/schema/bulk/schema";
import { requireComponent } from "./components";

type RequireAccess = (policy: string) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

async function getMediumRecord(storage: IStorage, medium: string, bulkId: string): Promise<unknown> {
  switch (medium) {
    case 'email': return storage.bulkMessagesEmail.getByBulkId(bulkId);
    case 'sms': return storage.bulkMessagesSms.getByBulkId(bulkId);
    case 'postal': return storage.bulkMessagesPostal.getByBulkId(bulkId);
    case 'inapp': return storage.bulkMessagesInapp.getByBulkId(bulkId);
    default: return null;
  }
}

export function registerBulkMessageRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const bulkComponent = requireComponent("bulk");

  app.get("/api/bulk-messages", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const medium = req.query.medium as string | undefined;
      const name = req.query.name as string | undefined;
      const items = await storage.bulkMessages.getAll({ status, medium, name });
      res.json(items);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch bulk messages";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-messages/:id", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const item = await storage.bulkMessages.getById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const mediumRecord = await getMediumRecord(storage, item.medium, item.id);
      res.json({ ...item, mediumRecord: mediumRecord || null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch bulk message";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const parsed = insertBulkMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }
      const item = await storage.bulkMessages.create(parsed.data);
      res.status(201).json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create bulk message";
      res.status(500).json({ message });
    }
  });

  app.patch("/api/bulk-messages/:id", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const existing = await storage.bulkMessages.getById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const body = { ...req.body };
      if (typeof body.sendDate === 'string') {
        body.sendDate = body.sendDate ? new Date(body.sendDate) : null;
      }
      const parsed = insertBulkMessageSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }
      if (parsed.data.medium && parsed.data.medium !== existing.medium) {
        const oldMediumRecord = await getMediumRecord(storage, existing.medium, existing.id);
        if (oldMediumRecord && typeof oldMediumRecord === 'object' && 'id' in oldMediumRecord) {
          const oldId = (oldMediumRecord as { id: string }).id;
          switch (existing.medium) {
            case 'email': await storage.bulkMessagesEmail.delete(oldId); break;
            case 'sms': await storage.bulkMessagesSms.delete(oldId); break;
            case 'postal': await storage.bulkMessagesPostal.delete(oldId); break;
            case 'inapp': await storage.bulkMessagesInapp.delete(oldId); break;
          }
        }
      }
      const item = await storage.bulkMessages.update(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      res.json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update bulk message";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/bulk-messages/:id", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const deleted = await storage.bulkMessages.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete bulk message";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-messages/:id/message", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }

      let mediumRecord: unknown = null;
      switch (bulk.medium) {
        case 'email':
          mediumRecord = await storage.bulkMessagesEmail.getByBulkId(bulk.id);
          break;
        case 'sms':
          mediumRecord = await storage.bulkMessagesSms.getByBulkId(bulk.id);
          break;
        case 'postal':
          mediumRecord = await storage.bulkMessagesPostal.getByBulkId(bulk.id);
          break;
        case 'inapp':
          mediumRecord = await storage.bulkMessagesInapp.getByBulkId(bulk.id);
          break;
      }

      res.json({ medium: bulk.medium, record: mediumRecord || null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch medium message";
      res.status(500).json({ message });
    }
  });

  app.put("/api/bulk-messages/:id/message", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }

      const { bulkId: _stripped, ...messageBody } = req.body;
      let result: unknown = null;

      switch (bulk.medium) {
        case 'email': {
          const existing = await storage.bulkMessagesEmail.getByBulkId(bulk.id);
          if (existing) {
            const parsed = insertBulkMessagesEmailSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesEmail.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesEmailSchema.safeParse({ ...messageBody, bulkId: bulk.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesEmail.create(parsed.data);
          }
          break;
        }
        case 'sms': {
          const existing = await storage.bulkMessagesSms.getByBulkId(bulk.id);
          if (existing) {
            const parsed = insertBulkMessagesSmsSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesSms.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesSmsSchema.safeParse({ ...messageBody, bulkId: bulk.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesSms.create(parsed.data);
          }
          break;
        }
        case 'postal': {
          const existing = await storage.bulkMessagesPostal.getByBulkId(bulk.id);
          if (existing) {
            const parsed = insertBulkMessagesPostalSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesPostal.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesPostalSchema.safeParse({ ...messageBody, bulkId: bulk.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesPostal.create(parsed.data);
          }
          break;
        }
        case 'inapp': {
          const existing = await storage.bulkMessagesInapp.getByBulkId(bulk.id);
          if (existing) {
            const parsed = insertBulkMessagesInappSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesInapp.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesInappSchema.safeParse({ ...messageBody, bulkId: bulk.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesInapp.create(parsed.data);
          }
          break;
        }
      }

      res.json({ medium: bulk.medium, record: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save medium message";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-messages/:id/logs", requireAuth, requireAccess('staff.bulk'), bulkComponent, async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { module, operation, startDate, endDate } = req.query;
      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds: [bulk.id],
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });
      res.json(logs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch bulk message logs";
      res.status(500).json({ message });
    }
  });
}

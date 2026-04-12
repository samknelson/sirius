import type { Express, Request, Response } from "express";
import { IStorage } from "../../storage";
import {
  insertBulkMessageSchema,
  insertBulkMessagesEmailSchema,
  insertBulkMessagesSmsSchema,
  insertBulkMessagesPostalSchema,
  insertBulkMessagesInappSchema,
  bulkParticipants,
} from "../../../shared/schema/bulk/schema";
import { contacts, workers, comm, phoneNumbers, contactPostal } from "../../../shared/schema";
import { eq, or, ilike, sql, inArray, and } from "drizzle-orm";
import { getClient } from "../../storage/transaction-context";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToContact, deliverToParticipant, resolveAddress } from "./deliver";
type RequireAccess = (policy: string) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

interface AuthenticatedUser {
  id: string;
  email?: string;
}

function getRequestUser(req: Request): AuthenticatedUser | undefined {
  return (req as Request & { user?: AuthenticatedUser }).user;
}

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

  app.get("/api/bulk-messages", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.get("/api/bulk-messages/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.post("/api/bulk-messages", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.patch("/api/bulk-messages/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.delete("/api/bulk-messages/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.get("/api/bulk-messages/:id/message", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.put("/api/bulk-messages/:id/message", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  app.get("/api/bulk-messages/:id/logs", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
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

  const rawParticipantStorage = createBulkParticipantStorage();

  app.get("/api/bulk-messages/:id/participants", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const db = getClient();
      const workerSub = db
        .selectDistinctOn([workers.contactId], {
          contactId: workers.contactId,
          id: workers.id,
          siriusId: workers.siriusId,
        })
        .from(workers)
        .as("w");
      const rows = await db
        .select({
          id: bulkParticipants.id,
          messageId: bulkParticipants.messageId,
          contactId: bulkParticipants.contactId,
          commId: bulkParticipants.commId,
          data: bulkParticipants.data,
          contactDisplayName: contacts.displayName,
          contactGiven: contacts.given,
          contactFamily: contacts.family,
          workerId: workerSub.id,
          workerSiriusId: workerSub.siriusId,
          commStatus: comm.status,
        })
        .from(bulkParticipants)
        .innerJoin(contacts, eq(bulkParticipants.contactId, contacts.id))
        .leftJoin(workerSub, eq(workerSub.contactId, contacts.id))
        .leftJoin(comm, eq(bulkParticipants.commId, comm.id))
        .where(eq(bulkParticipants.messageId, req.params.id));
      res.json(rows);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch participants";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/participants", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { contactId } = req.body;
      if (!contactId || typeof contactId !== 'string') {
        return res.status(400).json({ message: "contactId is required" });
      }
      const existing = await rawParticipantStorage.getByMessageId(req.params.id);
      if (existing.some(p => p.contactId === contactId)) {
        return res.status(409).json({ message: "Participant already exists for this message" });
      }
      const participant = await rawParticipantStorage.create({
        messageId: req.params.id,
        contactId,
      });
      res.status(201).json(participant);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to add participant";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/bulk-messages/:id/participants/:participantId", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const participant = await rawParticipantStorage.getById(req.params.participantId);
      if (!participant || participant.messageId !== req.params.id) {
        return res.status(404).json({ message: "Participant not found" });
      }
      await rawParticipantStorage.delete(req.params.participantId);
      res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to remove participant";
      res.status(500).json({ message });
    }
  });

  app.get("/api/contacts/search", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 2) {
        return res.json([]);
      }
      const db = getClient();
      const term = `%${q}%`;

      const rows = await db
        .select({
          id: contacts.id,
          displayName: contacts.displayName,
          email: contacts.email,
          given: contacts.given,
          family: contacts.family,
        })
        .from(contacts)
        .where(
          or(
            ilike(contacts.displayName, term),
            ilike(contacts.email, term),
            ilike(contacts.given, term),
            ilike(contacts.family, term),
          )
        )
        .limit(20);

      const contactIds = rows.map(r => r.id);
      if (contactIds.length === 0) {
        return res.json([]);
      }

      const phones = await db
        .select({
          contactId: phoneNumbers.contactId,
          number: phoneNumbers.number,
          isPrimary: phoneNumbers.isPrimary,
        })
        .from(phoneNumbers)
        .where(and(inArray(phoneNumbers.contactId, contactIds), eq(phoneNumbers.isActive, true)));

      const addrs = await db
        .select({
          contactId: contactPostal.contactId,
          street: contactPostal.street,
          city: contactPostal.city,
          state: contactPostal.state,
          isPrimary: contactPostal.isPrimary,
        })
        .from(contactPostal)
        .where(and(inArray(contactPostal.contactId, contactIds), eq(contactPostal.isActive, true)));

      const phoneMap = new Map<string, string>();
      for (const p of phones) {
        if (!phoneMap.has(p.contactId) || p.isPrimary) {
          phoneMap.set(p.contactId, p.number);
        }
      }

      const addrMap = new Map<string, string>();
      for (const a of addrs) {
        if (!addrMap.has(a.contactId) || a.isPrimary) {
          addrMap.set(a.contactId, [a.street, a.city, a.state].filter(Boolean).join(", "));
        }
      }

      const enriched = rows.map(r => ({
        ...r,
        primaryPhone: phoneMap.get(r.id) || null,
        primaryAddress: addrMap.get(r.id) || null,
      }));

      res.json(enriched);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to search contacts";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/resolve-address", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { contactId } = req.body;
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ message: "contactId is required" });
      }
      const result = await resolveAddress(storage, req.params.id, contactId);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to resolve address";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/deliver-test", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { contactId } = req.body;
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ message: "contactId is required" });
      }
      const user = getRequestUser(req);
      const result = await deliverToContact(storage, {
        messageId: req.params.id,
        contactId,
        userId: user?.id,
      });
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to deliver test message";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/deliver-participant/:participantId", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const user = getRequestUser(req);
      const result = await deliverToParticipant(
        storage,
        req.params.id,
        req.params.participantId,
        user?.id,
      );
      if (result.errorCode === "NOT_FOUND") {
        return res.status(404).json(result);
      }
      if (result.alreadySent) {
        return res.status(409).json(result);
      }
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to deliver to participant";
      res.status(500).json({ message });
    }
  });
}

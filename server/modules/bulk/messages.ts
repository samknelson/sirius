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
import { getClient, runInTransaction } from "../../storage/transaction-context";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToContact, deliverToParticipant, resolveAddressForMedium } from "./deliver";
import { storageLogger } from "../../logger";
import { resolveContactLinks, resolveContactLinksForMany } from "../contact-links";
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

async function deleteMediumRecord(storage: IStorage, medium: string, bulkId: string): Promise<void> {
  const record = await getMediumRecord(storage, medium, bulkId);
  if (record && typeof record === 'object' && 'id' in record) {
    const id = (record as { id: string }).id;
    switch (medium) {
      case 'email': await storage.bulkMessagesEmail.delete(id); break;
      case 'sms': await storage.bulkMessagesSms.delete(id); break;
      case 'postal': await storage.bulkMessagesPostal.delete(id); break;
      case 'inapp': await storage.bulkMessagesInapp.delete(id); break;
    }
  }
}

export function registerBulkMessageRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const rawParticipantStorage = createBulkParticipantStorage();

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
      const mediumRecords: Record<string, unknown> = {};
      for (const m of item.medium) {
        mediumRecords[m] = await getMediumRecord(storage, m, item.id) || null;
      }
      res.json({ ...item, mediumRecords });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch bulk message";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/from-recipients", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const body = req.body ?? {};
      const contactIds: unknown = body.contactIds;
      if (!Array.isArray(contactIds) || contactIds.length === 0 || !contactIds.every(c => typeof c === 'string' && c.length > 0)) {
        return res.status(400).json({ message: "contactIds must be a non-empty array of strings" });
      }

      const requestedMedium = Array.isArray(body.medium) && body.medium.length > 0 ? body.medium : ['email'];
      const allowedMedia = ['sms', 'email', 'inapp', 'postal'];
      const filteredMedium = Array.from(new Set((requestedMedium as unknown[]).filter(m => typeof m === 'string' && allowedMedia.includes(m)))) as string[];
      if (filteredMedium.length === 0) {
        return res.status(400).json({ message: "At least one valid medium is required" });
      }

      const sourceLabel = typeof body.sourceLabel === 'string' && body.sourceLabel.trim() ? body.sourceLabel.trim() : 'Recipients';
      const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const requestedName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
      const autoName = `${sourceLabel} — ${dateLabel} — ${contactIds.length} recipient${contactIds.length === 1 ? '' : 's'}`;
      const finalName = requestedName ?? autoName;

      const db = getClient();
      const uniqueIds = Array.from(new Set(contactIds as string[]));
      const existingContacts = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(inArray(contacts.id, uniqueIds));
      const validContactIds = new Set(existingContacts.map(c => c.id));
      const missingCount = uniqueIds.length - validContactIds.size;
      if (missingCount > 0) {
        const unresolvedIds = uniqueIds.filter(id => !validContactIds.has(id));
        return res.status(400).json({
          message: `${missingCount} of ${uniqueIds.length} supplied contactIds do not resolve to real contacts`,
          unresolvedContactIds: unresolvedIds.slice(0, 50),
          unresolvedCount: missingCount,
        });
      }

      const parsed = insertBulkMessageSchema.safeParse({
        name: finalName,
        medium: filteredMedium,
        status: 'draft',
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }

      const { created, participantsCreated } = await runInTransaction(async () => {
        const draft = await storage.bulkMessages.create(parsed.data);
        let count = 0;
        for (const cid of validContactIds) {
          for (const m of draft.medium) {
            await rawParticipantStorage.create({
              messageId: draft.id,
              contactId: cid,
              medium: m,
            });
            count++;
          }
        }
        return { created: draft, participantsCreated: count };
      });

      return res.status(201).json({
        bulkMessage: created,
        participantsCreated,
        recipientsRequested: uniqueIds.length,
        recipientsResolved: validContactIds.size,
        recipientsMissing: missingCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create bulk message from recipients";
      return res.status(500).json({ message });
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
      if (body.sendDate === null) {
        body.sendDate = null;
      } else if (typeof body.sendDate === 'string') {
        body.sendDate = body.sendDate ? new Date(body.sendDate) : null;
      }
      const parsed = insertBulkMessageSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }
      if (parsed.data.medium) {
        const oldMedia = new Set(existing.medium);
        const newMedia = new Set(parsed.data.medium);
        for (const m of oldMedia) {
          if (!newMedia.has(m)) {
            await deleteMediumRecord(storage, m, existing.id);
            await rawParticipantStorage.deleteByMessageAndMedium(existing.id, m);
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

      const medium = req.query.medium as string | undefined;
      if (medium) {
        if (!bulk.medium.includes(medium)) {
          return res.status(400).json({ message: `Medium "${medium}" is not selected for this message` });
        }
        const record = await getMediumRecord(storage, medium, bulk.id);
        return res.json({ medium, record: record || null });
      }

      const records: Record<string, unknown> = {};
      for (const m of bulk.medium) {
        records[m] = await getMediumRecord(storage, m, bulk.id) || null;
      }
      res.json({ media: bulk.medium, records });
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

      const medium = req.query.medium as string || req.body.medium;
      if (!medium || !bulk.medium.includes(medium)) {
        return res.status(400).json({ message: `Medium "${medium}" is not selected for this message` });
      }

      const { bulkId: _stripped, medium: _mediumStripped, ...messageBody } = req.body;
      let result: unknown = null;

      switch (medium) {
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

      res.json({ medium, record: result });
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
          medium: bulkParticipants.medium,
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
      const existingSet = new Set(existing.map(p => `${p.contactId}:${p.medium}`));

      const created: unknown[] = [];
      let skipped = 0;
      for (const m of bulk.medium) {
        const key = `${contactId}:${m}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }
        const participant = await rawParticipantStorage.create({
          messageId: req.params.id,
          contactId,
          medium: m,
        });
        created.push(participant);
      }

      if (created.length === 0 && skipped > 0) {
        return res.status(409).json({ message: "Participant already exists for all media" });
      }

      res.status(201).json({ created, skipped });
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

  app.get("/api/contacts/search", requireAuth, requireAccess('staff'), async (req, res) => {
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

      const contactIds = rows.map(r => r.id).filter(Boolean);
      if (contactIds.length === 0) {
        return res.json(rows.map(r => ({ ...r, primaryPhone: null, primaryAddress: null })));
      }

      let phones: { contactId: string; number: string; isPrimary: boolean }[] = [];
      let addrs: { contactId: string; street: string; city: string; state: string; isPrimary: boolean }[] = [];

      try {
        phones = await db
          .select({
            contactId: phoneNumbers.contactId,
            number: phoneNumbers.number,
            isPrimary: phoneNumbers.isPrimary,
          })
          .from(phoneNumbers)
          .where(and(inArray(phoneNumbers.contactId, contactIds), eq(phoneNumbers.isActive, true)));
      } catch (_e) {}

      try {
        addrs = await db
          .select({
            contactId: contactPostal.contactId,
            street: contactPostal.street,
            city: contactPostal.city,
            state: contactPostal.state,
            isPrimary: contactPostal.isPrimary,
          })
          .from(contactPostal)
          .where(and(inArray(contactPostal.contactId, contactIds), eq(contactPostal.isActive, true)));
      } catch (_e) {}

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

      let linkMap = new Map<string, { url: string; label: string } | null>();
      try {
        const resolved = await resolveContactLinksForMany(contactIds);
        for (const [cid, result] of resolved) {
          linkMap.set(cid, result.mainLink ? { url: result.mainLink.url, label: result.mainLink.label } : null);
        }
      } catch (_e) {}

      const enriched = rows.map(r => ({
        ...r,
        primaryPhone: phoneMap.get(r.id) || null,
        primaryAddress: addrMap.get(r.id) || null,
        mainLink: linkMap.get(r.id) || null,
      }));

      res.json(enriched);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to search contacts";
      res.status(500).json({ message });
    }
  });

  app.get("/api/contacts/:id/links", requireAuth, async (req, res) => {
    try {
      const result = await resolveContactLinks(req.params.id);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to resolve contact links";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/resolve-address", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { contactId, medium } = req.body;
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ message: "contactId is required" });
      }
      const targetMedium = medium || bulk.medium[0];
      if (!bulk.medium.includes(targetMedium)) {
        return res.status(400).json({ message: `Medium "${targetMedium}" is not selected for this message` });
      }
      const result = await resolveAddressForMedium(storage, targetMedium, contactId);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to resolve address";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-messages/:id/deliver-test", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    let medium: string | null = null;
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const { contactId } = req.body;
      medium = req.body.medium || bulk.medium[0];
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ message: "contactId is required" });
      }
      if (!bulk.medium.includes(medium!)) {
        return res.status(400).json({ message: `Medium "${medium}" is not selected for this message` });
      }
      const user = getRequestUser(req);
      const result = await deliverToContact(storage, {
        messageId: req.params.id,
        contactId,
        medium: medium!,
        userId: user?.id,
      });

      const logLevel = result.success ? "info" : "warn";
      const logMessage = result.success ? "Bulk test send completed" : "Bulk test send returned failure";
      storageLogger.log(logLevel, logMessage, {
        module: "bulk",
        operation: "test_send",
        host_entity_id: req.params.id,
        comm_id: result.commId || null,
        contact_id: contactId,
        medium,
        success: result.success,
        error: result.error || null,
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to deliver test message";

      storageLogger.error("Bulk test send failed", {
        module: "bulk",
        operation: "test_send",
        host_entity_id: req.params.id,
        comm_id: null,
        contact_id: req.body?.contactId ?? null,
        medium,
        success: false,
        error: message,
      });

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

  app.get("/api/bulk-messages/:id/delivery-stats", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const existing = await storage.bulkMessages.getById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Bulk message not found" });
      }
      const db = getClient();
      const rows = await db
        .select({
          participantStatus: bulkParticipants.status,
          medium: bulkParticipants.medium,
          commId: bulkParticipants.commId,
          commStatus: comm.status,
        })
        .from(bulkParticipants)
        .leftJoin(comm, eq(bulkParticipants.commId, comm.id))
        .where(eq(bulkParticipants.messageId, req.params.id));

      const total = rows.length;
      let pending = 0;
      let sendFailed = 0;
      let seeComm = 0;
      const commBreakdown: Record<string, number> = {};
      const byMedium: Record<string, { total: number; pending: number; sendFailed: number; seeComm: number }> = {};

      for (const row of rows) {
        const m = row.medium;
        if (!byMedium[m]) {
          byMedium[m] = { total: 0, pending: 0, sendFailed: 0, seeComm: 0 };
        }
        byMedium[m].total++;

        switch (row.participantStatus) {
          case "pending":
            pending++;
            byMedium[m].pending++;
            break;
          case "send_failed":
            sendFailed++;
            byMedium[m].sendFailed++;
            break;
          case "see_comm":
            seeComm++;
            byMedium[m].seeComm++;
            if (row.commStatus) {
              commBreakdown[row.commStatus] = (commBreakdown[row.commStatus] || 0) + 1;
            }
            break;
        }
      }

      res.json({ total, pending, sendFailed, seeComm, commBreakdown, byMedium });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to get delivery stats";
      res.status(500).json({ message });
    }
  });
}

import type { Express, Request, Response } from "express";
import { IStorage } from "../../storage";
import {
  insertBulkMessageSchema,
  insertBulkMessagesEmailSchema,
  insertBulkMessagesSmsSchema,
  insertBulkMessagesPostalSchema,
  insertBulkMessagesInappSchema,
} from "../../../shared/schema/bulk/schema";
import { runInTransaction } from "../../storage/transaction-context";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToContact, deliverToParticipant, resolveAddressForMedium } from "./deliver";
import { storageLogger } from "../../logger";
import { resolveContactLinks, resolveContactLinksForMany } from "../contact-links";
import { htmlToPlainText } from "../../../shared/utils/html/to-text";
import { extractTokenExpressions, parseTokenChain } from "@shared/tokens";
import {
  createTokenEvalContext,
  evaluateChain,
  buildSegmentSpecsForRoots,
  buildFieldCatalog,
  buildTokenCatalogForRoots,
  validateTokenExpressionForRoots,
  describeChain,
  listTokenTreeRoots,
  expandTokenType,
  searchTokenTree,
} from "../../plugins/tokens";
import type { TokenPreviewRecordRef } from "../../plugins/tokens/types";
import {
  BULK_PARTICIPANT_ENTITY_KIND,
  BULK_PARTICIPANT_ROOT_NAME,
  composeBulkParticipantEntity,
} from "../../plugins/tokens/plugins/bulk-participant";
import { BULK_TOKEN_ROOT_NAMES } from "./token-roots";

/**
 * How many of a message's sends the studio previews against.
 *
 * Enough to check a template against more than one person — a recipient
 * with a worker record and one without, an email and a letter — and few
 * enough that the seed panel stays a list an author reads rather than a
 * directory they search. A message with two thousand recipients is not
 * previewed two thousand ways.
 */
const BULK_STUDIO_SEED_LIMIT = 5;
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
      const deliveryStarted = await rawParticipantStorage.hasNonPendingForMessage(item.id);
      res.json({ ...item, mediumRecords, deliveryStarted });
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

      const uniqueIds = Array.from(new Set(contactIds as string[]));
      const existingIds = await storage.contacts.getExistingIds(uniqueIds);
      const validContactIds = new Set(existingIds);
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
        // Iterate the original deduped order so participant insert order matches
        // the recipient order the caller supplied.
        for (const cid of uniqueIds) {
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
      if (parsed.data.data !== undefined) {
        const existingData = (existing.data ?? {}) as Record<string, unknown>;
        const newData = (parsed.data.data ?? {}) as Record<string, unknown>;
        const existingOffline = existingData.offline === true;
        const newOffline = newData.offline === true;
        if (existingOffline !== newOffline) {
          const deliveryStarted = await rawParticipantStorage.hasNonPendingForMessage(existing.id);
          if (deliveryStarted) {
            return res.status(409).json({
              message: "Cannot change the offline delivery flag after delivery has started for this message.",
            });
          }
        }
      }
      if (parsed.data.medium) {
        const oldMedia = new Set<string>(existing.medium);
        const newMedia = new Set<string>(parsed.data.medium);
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
          // The client now sends only `bodyHtml`; derive the plain-text
          // fallback server-side so the two stay in sync.
          const emailBody: Record<string, unknown> = { ...messageBody };
          if (typeof emailBody.bodyHtml === 'string') {
            emailBody.bodyText = htmlToPlainText(emailBody.bodyHtml as string);
          }
          const existing = await storage.bulkMessagesEmail.getByBulkId(bulk.id);
          if (existing) {
            const parsed = insertBulkMessagesEmailSchema.partial().safeParse(emailBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesEmail.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesEmailSchema.safeParse({ ...emailBody, bulkId: bulk.id });
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
      const rows = await storage.bulkParticipants.listForMessageWithRelations(req.params.id);
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
      const rows = await storage.contacts.searchWithPrimaryContactInfo(q, 20);

      const contactIds = rows.map(r => r.id).filter(Boolean);
      let linkMap = new Map<string, { url: string; label: string } | null>();
      if (contactIds.length > 0) {
        try {
          const resolved = await resolveContactLinksForMany(contactIds);
          for (const [cid, result] of resolved) {
            linkMap.set(cid, result.mainLink ? { url: result.mainLink.url, label: result.mainLink.label } : null);
          }
        } catch (_e) {}
      }

      const enriched = rows.map(r => ({
        ...r,
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
      const rows = await storage.bulkParticipants.getDeliveryStats(req.params.id);

      const total = rows.length;
      let pending = 0;
      let sendFailed = 0;
      let seeComm = 0;
      const commBreakdown: Record<string, number> = {};
      const byMedium: Record<string, { total: number; pending: number; sendFailed: number; seeComm: number; commBreakdown: Record<string, number> }> = {};

      for (const row of rows) {
        const m = row.medium;
        if (!byMedium[m]) {
          byMedium[m] = { total: 0, pending: 0, sendFailed: 0, seeComm: 0, commBreakdown: {} };
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
              byMedium[m].commBreakdown[row.commStatus] = (byMedium[m].commBreakdown[row.commStatus] || 0) + 1;
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

  // Token catalog (picker entries) plus the segment graph the client
  // uses for static chain validation. Both are derived live from the
  // token plugin registry.
  //
  // The catalog belongs to ONE message, because the studio it feeds
  // previews against that message's OWN recipients: a bulk author is
  // writing to a list they have already chosen, so the seeds it supplies
  // are people who will actually receive this message rather than
  // whoever the author could look up. The recipients are still filtered
  // by the contact/worker read gates, like every other preview seed.
  app.get("/api/bulk-tokens/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }

      const { listTokenPreviewRoots } = await import(
        "../../plugins/tokens/preview-roots"
      );
      const { buildTokenStudioContext } = await import(
        "../../plugins/tokens/studio-context"
      );

      const allParticipants = await storage.bulkParticipants.listForMessageWithRelations(
        req.params.id,
      );
      // A handful, and the SAME handful for every root: the three seed
      // panels are three views of one short list of sends, not three
      // independent pickers. Ordered by name so reopening the studio
      // shows the same sends in the same places.
      const participants = [...allParticipants]
        .sort(
          (a, b) =>
            (a.contactDisplayName || "").localeCompare(b.contactDisplayName || "") ||
            a.medium.localeCompare(b.medium) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, BULK_STUDIO_SEED_LIMIT);

      const participantRecords: TokenPreviewRecordRef[] = participants.map((p) => ({
        id: p.id,
        label: p.contactDisplayName || "Unnamed contact",
        hint: p.medium,
        // Reading a participant is reading its recipient — the gate the
        // participant kind declares runs against the contact, not the
        // participant row.
        gateEntityId: p.contactId,
      }));
      // The same people, one entry each: a recipient written to on three
      // media is three sends but still one person to preview as.
      const contactRecords = new Map<string, TokenPreviewRecordRef>();
      const workerRecords = new Map<string, TokenPreviewRecordRef>();
      for (const p of participants) {
        const label = p.contactDisplayName || "Unnamed contact";
        if (p.contactId && !contactRecords.has(p.contactId)) {
          contactRecords.set(p.contactId, { id: p.contactId, label });
        }
        if (p.workerId && !workerRecords.has(p.workerId)) {
          workerRecords.set(p.workerId, {
            id: p.workerId,
            label,
            ...(p.workerSiriusId ? { hint: `#${p.workerSiriusId}` } : {}),
          });
        }
      }

      // A bulk message is ABOUT the sends it is going to make, so it
      // states exactly the roots it has records for (see
      // BULK_TOKEN_ROOT_NAMES) — the same list its tree, its validation
      // and its coverage check use. `system` is in that list and
      // seedless, so it is browsable but never appears in the seed panel.
      const rootNames = BULK_TOKEN_ROOT_NAMES;
      const recordsByRoot: Record<string, TokenPreviewRecordRef[]> = {};
      // Why a supplied list is empty is something only this message
      // knows, and "there is nobody to preview against" is the honest
      // answer an author needs where the picker would be.
      const emptyRecordsNotes: Record<string, string> = {};
      const noRecipients = allParticipants.length === 0;
      const noRecipientsNote =
        "This message has no recipients yet — add some on the Recipients tab to preview against a real one.";
      for (const root of listTokenPreviewRoots(rootNames)) {
        if (root.kind === BULK_PARTICIPANT_ENTITY_KIND) {
          recordsByRoot[root.name] = participantRecords;
          if (noRecipients) emptyRecordsNotes[root.name] = noRecipientsNote;
        } else if (root.kind === "contact") {
          recordsByRoot[root.name] = [...contactRecords.values()];
          if (noRecipients) emptyRecordsNotes[root.name] = noRecipientsNote;
        } else if (root.kind === "worker") {
          recordsByRoot[root.name] = [...workerRecords.values()];
          emptyRecordsNotes[root.name] = noRecipients
            ? noRecipientsNote
            : "None of the recipients shown here is linked to a worker record.";
        }
      }

      res.json({
        tokens: buildTokenCatalogForRoots(rootNames),
        segments: buildSegmentSpecsForRoots(rootNames),
        fields: buildFieldCatalog(),
        studioContext: await buildTokenStudioContext(
          { storage, req },
          {
            rootNames,
            recordsByRoot,
            emptyRecordsNotes,
            // The panels show the sends this message will make, not a
            // page of them: a short list an author reads at a glance.
            limit: BULK_STUDIO_SEED_LIMIT,
          },
        ),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load token catalog";
      res.status(500).json({ message });
    }
  });

  // Browsable token tree for bulk messaging — the same lazy tree the
  // Template Studio walks, gated for bulk authors instead of admins.
  // The roots are bulk's own declared list, fixed server-side: the
  // caller cannot ask for a root bulk has not declared.
  app.get("/api/bulk-tokens/tree/roots", requireAuth, requireAccess('bulk.edit'), (_req, res) => {
    res.json({ roots: listTokenTreeRoots(BULK_TOKEN_ROOT_NAMES) });
  });

  app.get("/api/bulk-tokens/tree/type/:type", requireAuth, requireAccess('bulk.edit'), (req, res) => {
    res.json(expandTokenType(req.params.type));
  });

  app.get("/api/bulk-tokens/tree/search", requireAuth, requireAccess('bulk.edit'), (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ hits: searchTokenTree(BULK_TOKEN_ROOT_NAMES, q) });
  });

  // Returns per-token coverage across this message's participants:
  // for every token used in any channel template, how many distinct
  // recipients are missing a value. Used by the deliver page to warn
  // the author before they queue the message.
  app.get("/api/bulk-messages/:id/token-coverage", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const bulk = await storage.bulkMessages.getById(req.params.id);
      if (!bulk) {
        return res.status(404).json({ message: "Bulk message not found" });
      }

      const templates: string[] = [];
      const email = await storage.bulkMessagesEmail.getByBulkId(bulk.id);
      if (email) templates.push(email.subject || "", email.bodyText || "", email.bodyHtml || "");
      const sms = await storage.bulkMessagesSms.getByBulkId(bulk.id);
      if (sms) templates.push(sms.body || "");
      const inapp = await storage.bulkMessagesInapp.getByBulkId(bulk.id);
      if (inapp) templates.push(inapp.title || "", inapp.body || "", inapp.linkLabel || "");
      const postal = await storage.bulkMessagesPostal.getByBulkId(bulk.id);
      if (postal) templates.push(postal.description || "");

      // Only cover expressions that parse + validate against the roots
      // bulk declares; invalid ones are surfaced by the editor's warnings.
      const tokenIds = Array.from(new Set(
        templates.flatMap((t) => extractTokenExpressions(t))
          .filter((expr) => validateTokenExpressionForRoots(expr, BULK_TOKEN_ROOT_NAMES).ok)
      ));

      // Coverage is measured per SEND, because that is what delivery
      // renders: the same person written to by two media is two renders,
      // and a token about the send itself ({{bulk_participant.medium}})
      // has a different value in each. Recipients are still counted as
      // people — a recipient is short of a value if ANY of their sends
      // comes out blank.
      const sends = (await storage.bulkParticipants.getByMessageId(req.params.id))
        .filter((p) => Boolean(p.contactId));
      const contactIds = Array.from(new Set(sends.map((p) => p.contactId)));

      const describe = (expr: string) => describeChain(expr) || { label: expr, defaultValue: "", example: "", scope: "system" };

      if (tokenIds.length === 0 || contactIds.length === 0) {
        return res.json({
          totalRecipients: contactIds.length,
          perToken: tokenIds.map((id) => ({
            tokenId: id,
            label: describe(id).label,
            defaultValue: describe(id).defaultValue,
            missingCount: 0,
            missingSample: [] as { contactId: string; name: string }[],
          })),
        });
      }

      const contactRows = await storage.bulkTokens.getContactsBasicByIds(contactIds);
      const nameById = new Map(
        contactRows.map((c) => [c.id, c.displayName || `${c.given || ''} ${c.family || ''}`.trim() || c.id]),
      );

      const parsedChains = tokenIds
        .map((id) => ({ id, parsed: parseTokenChain(id) }))
        .filter((c): c is { id: string; parsed: { ok: true; segments: import("@shared/tokens").TokenSegment[] } } => c.parsed.ok);

      // One recipient per token at most, however many sends they get.
      const missing: Record<string, Map<string, { contactId: string; name: string }>> = {};
      for (const id of tokenIds) missing[id] = new Map();

      // Evaluate every used chain per send through the plugin
      // evaluator, seeded with that send exactly as delivery seeds it —
      // so a participant token is measured against the real thing
      // rather than counted missing for everybody. A shared memo cache
      // dedupes cross-recipient lookups (option names, employers) —
      // memo keys are fully qualified. Bounded parallelism keeps big
      // recipient lists from turning the authoring endpoint into
      // thousands of serial round-trips.
      const sharedCache = new Map<string, unknown>();
      const CONCURRENCY = 8;
      for (let i = 0; i < sends.length; i += CONCURRENCY) {
        await Promise.all(sends.slice(i, i + CONCURRENCY).map(async (send) => {
          const cid = send.contactId;
          const ctx = createTokenEvalContext(storage, cid, {
            cache: sharedCache,
            seeds: [
              {
                name: BULK_PARTICIPANT_ROOT_NAME,
                entity: composeBulkParticipantEntity(send),
              },
            ],
          });
          for (const { id, parsed } of parsedChains) {
            const result = await evaluateChain(parsed.segments, ctx);
            if (result.status !== "ok" || result.value === "") {
              missing[id].set(cid, { contactId: cid, name: nameById.get(cid) || cid });
            }
          }
        }));
      }

      const perToken = tokenIds.map((tid) => ({
        tokenId: tid,
        label: describe(tid).label,
        defaultValue: describe(tid).defaultValue,
        missingCount: missing[tid].size,
        missingSample: [...missing[tid].values()].slice(0, 10),
      }));

      res.json({ totalRecipients: contactIds.length, perToken });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to compute token coverage";
      res.status(500).json({ message });
    }
  });

  // Bulk message content previews go through the single Template Studio
  // preview route (POST /api/template-studio/preview, surface
  // "bulk-message"); there is no bulk-specific preview endpoint.
}

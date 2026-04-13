import type { Express, Request, Response } from "express";
import { IStorage } from "../../storage";
import {
  insertBulkCampaignSchema,
  updateBulkCampaignSchema,
  insertBulkMessageSchema,
  insertBulkMessagesEmailSchema,
  insertBulkMessagesSmsSchema,
  insertBulkMessagesPostalSchema,
  insertBulkMessagesInappSchema,
  bulkParticipants,
  bulkMessages,
  bulkCampaigns,
} from "../../../shared/schema/bulk/schema";
import { contacts, workers, phoneNumbers, contactPostal, comm, users } from "../../../shared/schema";
import { eq, and, inArray, sql, ilike, or, type SQL } from "drizzle-orm";
import { getClient } from "../../storage/transaction-context";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToContact } from "./deliver";
import { storageLogger } from "../../logger";
import { getAvailableTokens } from "../../services/bulk-tokenization";
import { z } from "zod";

type RequireAccess = (policy: string) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

interface AuthenticatedUser {
  id: string;
  email?: string;
}

function getRequestUser(req: Request): AuthenticatedUser | undefined {
  return (req as Request & { user?: AuthenticatedUser }).user;
}

const rawParticipantStorage = createBulkParticipantStorage();

const VALID_CHANNELS = ["email", "sms", "postal", "inapp"] as const;
type Channel = typeof VALID_CHANNELS[number];

export function registerBulkCampaignRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {

  app.get("/api/bulk-campaigns", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const name = req.query.name as string | undefined;
      const campaigns = await storage.bulkCampaigns.getAll({ status, name });

      const db = getClient();
      const enriched = await Promise.all(campaigns.map(async (campaign) => {
        const msgs = await db
          .select({ medium: bulkMessages.medium, status: bulkMessages.status })
          .from(bulkMessages)
          .where(eq(bulkMessages.campaignId, campaign.id));

        const participantStats = await db
          .select({
            status: bulkParticipants.status,
            count: sql<number>`count(*)::int`,
          })
          .from(bulkParticipants)
          .innerJoin(bulkMessages, eq(bulkParticipants.messageId, bulkMessages.id))
          .where(eq(bulkMessages.campaignId, campaign.id))
          .groupBy(bulkParticipants.status);

        const totalParticipants = participantStats.reduce((sum, s) => sum + s.count, 0);
        const pendingCount = participantStats.find(s => s.status === "pending")?.count || 0;
        const sentCount = participantStats.find(s => s.status === "see_comm")?.count || 0;
        const failedCount = participantStats.find(s => s.status === "send_failed")?.count || 0;
        const progress = totalParticipants > 0 ? Math.round(((sentCount + failedCount) / totalParticipants) * 100) : 0;

        let creatorName: string | null = null;
        if (campaign.creatorUserId) {
          const creator = await storage.users.getUser(campaign.creatorUserId);
          if (creator) {
            creatorName = [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.email || null;
          }
        }

        return {
          ...campaign,
          creatorName,
          channelMessages: msgs,
          audienceSize: totalParticipants / Math.max(msgs.length, 1),
          totalParticipants,
          pendingCount,
          sentCount,
          failedCount,
          progress,
        };
      }));

      res.json(enriched);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch campaigns";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const result = await storage.bulkCampaigns.getByIdWithMessages(req.params.id);
      if (!result) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      let creatorName: string | null = null;
      if (result.creatorUserId) {
        const creator = await storage.users.getUser(result.creatorUserId);
        if (creator) {
          creatorName = [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.email || null;
        }
      }

      const channelContent: Record<string, unknown> = {};
      for (const msg of result.messages) {
        switch (msg.medium) {
          case 'email':
            channelContent.email = await storage.bulkMessagesEmail.getByBulkId(msg.id);
            break;
          case 'sms':
            channelContent.sms = await storage.bulkMessagesSms.getByBulkId(msg.id);
            break;
          case 'postal':
            channelContent.postal = await storage.bulkMessagesPostal.getByBulkId(msg.id);
            break;
          case 'inapp':
            channelContent.inapp = await storage.bulkMessagesInapp.getByBulkId(msg.id);
            break;
        }
      }

      res.json({ ...result, creatorName, channelContent });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch campaign";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-campaigns", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const user = getRequestUser(req);
      const { channels: requestedChannels, ...campaignBody } = req.body;

      const validChannels: Channel[] = (requestedChannels || []).filter((c: string) =>
        VALID_CHANNELS.includes(c as Channel)
      );
      if (validChannels.length === 0) {
        return res.status(400).json({ message: "At least one valid channel is required (email, sms, postal, inapp)" });
      }

      const parsed = insertBulkCampaignSchema.safeParse({
        name: campaignBody.name,
        audienceType: campaignBody.audienceType,
        audienceFilters: campaignBody.audienceFilters,
        data: campaignBody.data,
        channels: validChannels,
        status: "draft",
        creatorUserId: user?.id || null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }

      const db = getClient();
      const campaign = await db.transaction(async () => {
        const created = await storage.bulkCampaigns.create(parsed.data);
        const createdMessages = [];
        for (const channel of validChannels) {
          const msg = await storage.bulkMessages.create({
            campaignId: created.id,
            medium: channel,
            name: `${created.name} - ${channel}`,
            status: "draft",
          });
          createdMessages.push(msg);
        }
        return { ...created, messages: createdMessages };
      });

      res.status(201).json(campaign);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create campaign";
      res.status(500).json({ message });
    }
  });

  app.patch("/api/bulk-campaigns/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const existing = await storage.bulkCampaigns.getById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      if (existing.status !== "draft") {
        return res.status(400).json({ message: "Only draft campaigns can be updated" });
      }

      const { status: _s, creatorUserId: _c, ...safeBody } = req.body;
      if (safeBody.scheduledAt === null) {
        safeBody.scheduledAt = null;
      } else if (typeof safeBody.scheduledAt === 'string') {
        safeBody.scheduledAt = safeBody.scheduledAt ? new Date(safeBody.scheduledAt) : null;
      }

      const parsed = updateBulkCampaignSchema.safeParse(safeBody);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }

      const updated = await storage.bulkCampaigns.update(req.params.id, parsed.data);
      res.json(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update campaign";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/bulk-campaigns/:id", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const existing = await storage.bulkCampaigns.getById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      if (existing.status !== "draft" && existing.status !== "aborted" && existing.status !== "completed" && existing.status !== "failed") {
        return res.status(400).json({ message: "Cannot delete a campaign that is currently queued or processing" });
      }
      await storage.bulkCampaigns.delete(req.params.id);
      res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete campaign";
      res.status(500).json({ message });
    }
  });

  app.put("/api/bulk-campaigns/:id/messages/:medium", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const medium = req.params.medium as Channel;
      if (!VALID_CHANNELS.includes(medium)) {
        return res.status(400).json({ message: `Invalid medium: ${medium}` });
      }

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      const msg = campaignMessages.find(m => m.medium === medium);
      if (!msg) {
        return res.status(404).json({ message: `No ${medium} channel configured for this campaign` });
      }

      const { bulkId: _stripped, ...messageBody } = req.body;
      let result: unknown = null;

      switch (medium) {
        case 'email': {
          const existing = await storage.bulkMessagesEmail.getByBulkId(msg.id);
          if (existing) {
            const parsed = insertBulkMessagesEmailSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesEmail.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesEmailSchema.safeParse({ ...messageBody, bulkId: msg.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesEmail.create(parsed.data);
          }
          break;
        }
        case 'sms': {
          const existing = await storage.bulkMessagesSms.getByBulkId(msg.id);
          if (existing) {
            const parsed = insertBulkMessagesSmsSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesSms.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesSmsSchema.safeParse({ ...messageBody, bulkId: msg.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesSms.create(parsed.data);
          }
          break;
        }
        case 'postal': {
          const existing = await storage.bulkMessagesPostal.getByBulkId(msg.id);
          if (existing) {
            const parsed = insertBulkMessagesPostalSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesPostal.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesPostalSchema.safeParse({ ...messageBody, bulkId: msg.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesPostal.create(parsed.data);
          }
          break;
        }
        case 'inapp': {
          const existing = await storage.bulkMessagesInapp.getByBulkId(msg.id);
          if (existing) {
            const parsed = insertBulkMessagesInappSchema.partial().safeParse(messageBody);
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesInapp.update(existing.id, parsed.data);
          } else {
            const parsed = insertBulkMessagesInappSchema.safeParse({ ...messageBody, bulkId: msg.id });
            if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
            result = await storage.bulkMessagesInapp.create(parsed.data);
          }
          break;
        }
      }

      res.json({ medium, record: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save channel content";
      res.status(500).json({ message });
    }
  });

  const importAudienceSchema = z.object({
    contactIds: z.array(z.string()).optional(),
    audienceType: z.enum(["worker", "employer_contact"]).optional(),
    filters: z.record(z.unknown()).optional(),
  });

  app.post("/api/bulk-campaigns/:id/import-audience", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      if (campaign.status !== "draft") {
        return res.status(400).json({ message: "Audience can only be imported into draft campaigns" });
      }

      const parsed = importAudienceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.issues });
      }

      let contactIds: string[] = [];

      if (parsed.data.contactIds && parsed.data.contactIds.length > 0) {
        contactIds = parsed.data.contactIds;
      } else if (parsed.data.audienceType === "worker") {
        const db = getClient();
        const filters = (parsed.data.filters || {}) as Record<string, unknown>;
        const conditions: SQL[] = [];

        if (filters.workStatusId && typeof filters.workStatusId === "string") {
          conditions.push(eq(workers.denormWsId, filters.workStatusId));
        }
        if (filters.homeEmployerId && typeof filters.homeEmployerId === "string") {
          conditions.push(eq(workers.denormHomeEmployerId, filters.homeEmployerId));
        }
        if (filters.bargainingUnitId && typeof filters.bargainingUnitId === "string") {
          conditions.push(eq(workers.bargainingUnitId, filters.bargainingUnitId));
        }
        if (filters.employerId && typeof filters.employerId === "string") {
          conditions.push(sql`${workers.denormEmployerIds} @> ARRAY[${filters.employerId}]::varchar[]`);
        }
        if (filters.memberStatusIds && Array.isArray(filters.memberStatusIds) && filters.memberStatusIds.length > 0) {
          conditions.push(sql`${workers.denormMsIds} && ARRAY[${sql.join(filters.memberStatusIds.map((id: string) => sql`${id}`), sql`, `)}]::varchar[]`);
        }
        if (filters.search && typeof filters.search === "string") {
          const searchTerm = `%${filters.search}%`;
          conditions.push(
            sql`EXISTS (SELECT 1 FROM contacts c WHERE c.id = ${workers.contactId} AND (c.display_name ILIKE ${searchTerm} OR c.email ILIKE ${searchTerm}))`
          );
        }

        let query = db.select({ contactId: workers.contactId }).from(workers);
        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as typeof query;
        }
        const rows = await query;
        contactIds = rows.map(r => r.contactId).filter(Boolean) as string[];
      } else if (parsed.data.audienceType === "employer_contact") {
        const db = getClient();
        const { employerContacts } = await import("../../../shared/schema");
        const filters = (parsed.data.filters || {}) as Record<string, unknown>;
        const conditions: SQL[] = [];

        if (filters.employerId && typeof filters.employerId === "string") {
          conditions.push(eq(employerContacts.employerId, filters.employerId));
        }
        if (filters.contactTypeId && typeof filters.contactTypeId === "string") {
          conditions.push(eq(employerContacts.contactTypeId, filters.contactTypeId));
        }
        if (filters.employerIds && Array.isArray(filters.employerIds) && filters.employerIds.length > 0) {
          conditions.push(inArray(employerContacts.employerId, filters.employerIds as string[]));
        }

        let query = db.select({ contactId: employerContacts.contactId }).from(employerContacts);
        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as typeof query;
        }
        const rows = await query;
        contactIds = rows.map(r => r.contactId).filter(Boolean) as string[];
      }

      if (contactIds.length === 0) {
        return res.status(400).json({ message: "No contacts found for the given criteria" });
      }

      const uniqueContactIds = [...new Set(contactIds)];

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      if (campaignMessages.length === 0) {
        return res.status(400).json({ message: "Campaign has no channel messages configured" });
      }

      let totalCreated = 0;
      let totalSkipped = 0;

      for (const msg of campaignMessages) {
        const existingParticipants = await rawParticipantStorage.getByMessageId(msg.id);
        const existingContactIds = new Set(existingParticipants.map(p => p.contactId));

        const db = getClient();
        const newContactIds = uniqueContactIds.filter(cid => !existingContactIds.has(cid));
        totalSkipped += (uniqueContactIds.length - newContactIds.length);

        if (newContactIds.length > 0) {
          const batchSize = 500;
          for (let i = 0; i < newContactIds.length; i += batchSize) {
            const batch = newContactIds.slice(i, i + batchSize);
            const values = batch.map(contactId => ({
              messageId: msg.id,
              contactId,
            }));
            await db
              .insert(bulkParticipants)
              .values(values);
          }
          totalCreated += newContactIds.length;
        }
      }

      if (parsed.data.audienceType) {
        await storage.bulkCampaigns.update(campaign.id, {
          audienceType: parsed.data.audienceType,
          audienceFilters: parsed.data.filters || null,
        });
      }

      res.json({
        totalContacts: uniqueContactIds.length,
        totalCreated,
        totalSkipped,
        channelCount: campaignMessages.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to import audience";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/:id/readiness", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      if (campaignMessages.length === 0) {
        return res.json({ channels: {} });
      }

      const db = getClient();

      const anyMsgId = campaignMessages[0].id;
      const allParticipants = await db
        .select({
          contactId: bulkParticipants.contactId,
          email: contacts.email,
        })
        .from(bulkParticipants)
        .innerJoin(contacts, eq(bulkParticipants.contactId, contacts.id))
        .where(eq(bulkParticipants.messageId, anyMsgId));

      const contactIds = allParticipants.map(p => p.contactId);
      const totalContacts = contactIds.length;

      if (totalContacts === 0) {
        return res.json({ channels: {}, totalContacts: 0 });
      }

      const readiness: Record<string, { ready: number; missing: number; total: number }> = {};

      for (const msg of campaignMessages) {
        switch (msg.medium) {
          case "email": {
            const withEmail = allParticipants.filter(p => p.email).length;
            readiness.email = { ready: withEmail, missing: totalContacts - withEmail, total: totalContacts };
            break;
          }
          case "sms": {
            let phoneContactIds: Set<string> = new Set();
            if (contactIds.length > 0) {
              const batchSize = 500;
              for (let i = 0; i < contactIds.length; i += batchSize) {
                const batch = contactIds.slice(i, i + batchSize);
                const phones = await db
                  .select({ contactId: phoneNumbers.contactId })
                  .from(phoneNumbers)
                  .where(and(
                    inArray(phoneNumbers.contactId, batch),
                    eq(phoneNumbers.isActive, true),
                  ));
                phones.forEach(p => phoneContactIds.add(p.contactId));
              }
            }
            readiness.sms = { ready: phoneContactIds.size, missing: totalContacts - phoneContactIds.size, total: totalContacts };
            break;
          }
          case "postal": {
            let postalContactIds: Set<string> = new Set();
            if (contactIds.length > 0) {
              const batchSize = 500;
              for (let i = 0; i < contactIds.length; i += batchSize) {
                const batch = contactIds.slice(i, i + batchSize);
                const addrs = await db
                  .select({ contactId: contactPostal.contactId })
                  .from(contactPostal)
                  .where(and(
                    inArray(contactPostal.contactId, batch),
                    eq(contactPostal.isActive, true),
                  ));
                addrs.forEach(a => postalContactIds.add(a.contactId));
              }
            }
            readiness.postal = { ready: postalContactIds.size, missing: totalContacts - postalContactIds.size, total: totalContacts };
            break;
          }
          case "inapp": {
            let userCount = 0;
            const emailsToCheck = allParticipants
              .filter(p => p.email)
              .map(p => p.email!);
            if (emailsToCheck.length > 0) {
              const batchSize = 500;
              for (let i = 0; i < emailsToCheck.length; i += batchSize) {
                const batch = emailsToCheck.slice(i, i + batchSize);
                const usersFound = await db
                  .select({ id: users.id })
                  .from(users)
                  .where(inArray(users.email, batch));
                userCount += usersFound.length;
              }
            }
            readiness.inapp = { ready: userCount, missing: totalContacts - userCount, total: totalContacts };
            break;
          }
        }
      }

      res.json({ channels: readiness, totalContacts });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to check readiness";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-campaigns/:id/queue", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      if (campaign.status !== "draft") {
        return res.status(400).json({ message: "Only draft campaigns can be queued" });
      }

      const { scheduledAt } = req.body;
      let schedDate: Date | null = null;
      if (scheduledAt !== undefined && scheduledAt !== null) {
        const parsed = new Date(scheduledAt);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ message: "Invalid scheduledAt date format" });
        }
        schedDate = parsed;
      }

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      for (const msg of campaignMessages) {
        await storage.bulkMessages.update(msg.id, {
          status: "queued",
          sendDate: schedDate,
        });
      }

      await storage.bulkCampaigns.update(campaign.id, {
        status: "queued",
        scheduledAt: schedDate,
      });

      storageLogger.info("Campaign queued", {
        module: "bulk_campaign",
        operation: "queue",
        host_entity_id: campaign.id,
        campaign_name: campaign.name,
        channel_count: campaignMessages.length,
        scheduled_at: schedDate?.toISOString() || "immediate",
      });

      res.json({ success: true, status: "queued", scheduledAt: schedDate });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to queue campaign";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-campaigns/:id/abort", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      if (campaign.status !== "queued" && campaign.status !== "processing") {
        return res.status(400).json({ message: "Only queued or processing campaigns can be aborted" });
      }

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      for (const msg of campaignMessages) {
        await storage.bulkMessages.update(msg.id, { status: "draft" });
      }

      await storage.bulkCampaigns.update(campaign.id, { status: "aborted" });

      storageLogger.info("Campaign aborted", {
        module: "bulk_campaign",
        operation: "abort",
        host_entity_id: campaign.id,
        campaign_name: campaign.name,
      });

      res.json({ success: true, status: "aborted" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to abort campaign";
      res.status(500).json({ message });
    }
  });

  app.post("/api/bulk-campaigns/:id/test-send", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const user = getRequestUser(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { medium, contactId } = req.body;
      if (medium && !VALID_CHANNELS.includes(medium)) {
        return res.status(400).json({ message: "Invalid medium. Must be one of: email, sms, postal, inapp" });
      }

      const targetContactId = contactId || null;
      let resolvedContactId = targetContactId;

      if (!resolvedContactId && user.email) {
        const db = getClient();
        const [contact] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.email, user.email))
          .limit(1);
        if (contact) {
          resolvedContactId = contact.id;
        }
      }

      if (!resolvedContactId) {
        return res.status(400).json({ message: "Could not resolve a contact for test send. Please provide a contactId." });
      }

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      const messagesToSend = medium
        ? campaignMessages.filter(m => m.medium === medium)
        : campaignMessages;

      if (messagesToSend.length === 0) {
        return res.status(404).json({ message: medium ? `No ${medium} channel configured for this campaign` : "No channels configured for this campaign" });
      }

      const results: Array<{ medium: string; success: boolean; commId?: string; error?: string }> = [];
      for (const msg of messagesToSend) {
        const result = await deliverToContact(storage, {
          messageId: msg.id,
          contactId: resolvedContactId,
          userId: user.id,
        });

        storageLogger.log(result.success ? "info" : "warn", result.success ? "Campaign test send completed" : "Campaign test send failed", {
          module: "bulk_campaign",
          operation: "test_send",
          host_entity_id: campaign.id,
          comm_id: result.commId || null,
          contact_id: resolvedContactId,
          medium: msg.medium,
          success: result.success,
          error: result.error || null,
        });

        results.push({
          medium: msg.medium,
          success: result.success,
          commId: result.commId,
          error: result.error,
        });
      }

      if (results.length === 1) {
        res.json(results[0]);
      } else {
        const allSuccess = results.every(r => r.success);
        res.json({ success: allSuccess, channels: results });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send test message";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/:id/stats", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const db = getClient();
      const rows = await db
        .select({
          medium: bulkMessages.medium,
          participantStatus: bulkParticipants.status,
          commStatus: comm.status,
          count: sql<number>`count(*)::int`,
        })
        .from(bulkParticipants)
        .innerJoin(bulkMessages, eq(bulkParticipants.messageId, bulkMessages.id))
        .leftJoin(comm, eq(bulkParticipants.commId, comm.id))
        .where(eq(bulkMessages.campaignId, req.params.id))
        .groupBy(bulkMessages.medium, bulkParticipants.status, comm.status);

      const channelStats: Record<string, {
        total: number;
        pending: number;
        sent: number;
        failed: number;
        commBreakdown: Record<string, number>;
      }> = {};

      for (const row of rows) {
        if (!channelStats[row.medium]) {
          channelStats[row.medium] = { total: 0, pending: 0, sent: 0, failed: 0, commBreakdown: {} };
        }
        const cs = channelStats[row.medium];
        cs.total += row.count;
        switch (row.participantStatus) {
          case "pending":
            cs.pending += row.count;
            break;
          case "see_comm":
            cs.sent += row.count;
            if (row.commStatus) {
              cs.commBreakdown[row.commStatus] = (cs.commBreakdown[row.commStatus] || 0) + row.count;
            }
            break;
          case "send_failed":
            cs.failed += row.count;
            break;
        }
      }

      const totalSent = Object.values(channelStats).reduce((s, c) => s + c.sent, 0);
      const totalFailed = Object.values(channelStats).reduce((s, c) => s + c.failed, 0);
      const totalPending = Object.values(channelStats).reduce((s, c) => s + c.pending, 0);
      const totalAll = Object.values(channelStats).reduce((s, c) => s + c.total, 0);
      const overallProgress = totalAll > 0 ? Math.round(((totalSent + totalFailed) / totalAll) * 100) : 0;

      res.json({
        campaignId: campaign.id,
        status: campaign.status,
        channelStats,
        totals: { total: totalAll, pending: totalPending, sent: totalSent, failed: totalFailed },
        overallProgress,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to get campaign stats";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/:id/errors", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const db = getClient();
      const errors = await db
        .select({
          participantId: bulkParticipants.id,
          contactId: bulkParticipants.contactId,
          contactDisplayName: contacts.displayName,
          contactGiven: contacts.given,
          contactFamily: contacts.family,
          contactEmail: contacts.email,
          medium: bulkMessages.medium,
          errorMessage: bulkParticipants.message,
        })
        .from(bulkParticipants)
        .innerJoin(bulkMessages, eq(bulkParticipants.messageId, bulkMessages.id))
        .innerJoin(contacts, eq(bulkParticipants.contactId, contacts.id))
        .where(and(
          eq(bulkMessages.campaignId, req.params.id),
          eq(bulkParticipants.status, "send_failed"),
        ));

      res.json(errors);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to get campaign errors";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/tokens/available", requireAuth, requireAccess('bulk.edit'), async (_req, res) => {
    try {
      res.json(getAvailableTokens());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to get available tokens";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-campaigns/:id/participants", requireAuth, requireAccess('bulk.edit'), async (req, res) => {
    try {
      const campaign = await storage.bulkCampaigns.getById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }

      const medium = req.query.medium as string | undefined;

      const db = getClient();
      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);
      const targetMsg = medium ? campaignMessages.find(m => m.medium === medium) : campaignMessages[0];
      if (!targetMsg) {
        return res.json([]);
      }

      const rows = await db
        .select({
          id: bulkParticipants.id,
          messageId: bulkParticipants.messageId,
          contactId: bulkParticipants.contactId,
          status: bulkParticipants.status,
          message: bulkParticipants.message,
          contactDisplayName: contacts.displayName,
          contactGiven: contacts.given,
          contactFamily: contacts.family,
          contactEmail: contacts.email,
        })
        .from(bulkParticipants)
        .innerJoin(contacts, eq(bulkParticipants.contactId, contacts.id))
        .where(eq(bulkParticipants.messageId, targetMsg.id));

      res.json(rows);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to get participants";
      res.status(500).json({ message });
    }
  });
}

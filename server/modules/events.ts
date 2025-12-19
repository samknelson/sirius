import type { Express } from "express";
import { storage } from "../storage";
import { insertEventSchema, insertEventOccurrenceSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { requireComponent } from "./components";
import { 
  getAllEventCategories, 
  getEventCategory, 
  getCategoryRoles, 
  getCategoryStatuses,
  getCategoryConfigOptions,
  validateParticipantRole,
  validateParticipantStatus
} from "./event-categories";
import { insertEventParticipantSchema } from "@shared/schema";
import { executeChargePlugins, TriggerType, type ParticipantSavedContext } from "../charge-plugins";
import { logger } from "../logger";

export function registerEventsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const eventComponent = requireComponent("event");

  app.get("/api/event-categories", eventComponent, async (req, res) => {
    try {
      const categories = getAllEventCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event categories" });
    }
  });

  app.get("/api/event-categories/:categoryId", eventComponent, async (req, res) => {
    try {
      const { categoryId } = req.params;
      const category = getEventCategory(categoryId);
      
      if (!category) {
        res.status(404).json({ message: "Category not found" });
        return;
      }
      
      res.json(category);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event category" });
    }
  });

  app.get("/api/event-categories/:categoryId/roles", eventComponent, async (req, res) => {
    try {
      const { categoryId } = req.params;
      const roles = getCategoryRoles(categoryId);
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch category roles" });
    }
  });

  app.get("/api/event-categories/:categoryId/statuses", eventComponent, async (req, res) => {
    try {
      const { categoryId } = req.params;
      const statuses = getCategoryStatuses(categoryId);
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch category statuses" });
    }
  });

  app.get("/api/event-categories/:categoryId/config-options", eventComponent, async (req, res) => {
    try {
      const { categoryId } = req.params;
      const scope = req.query.scope as "type" | "event" | undefined;
      const configOptions = getCategoryConfigOptions(categoryId, scope);
      res.json(configOptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch category config options" });
    }
  });

  app.get("/api/events", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const events = await storage.events.getAll();
      
      // Include occurrences for each event
      const eventsWithOccurrences = await Promise.all(
        events.map(async (event) => {
          const occurrences = await storage.eventOccurrences.getAll(event.id);
          return { ...event, occurrences };
        })
      );
      
      res.json(eventsWithOccurrences);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get("/api/events/:id", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const occurrences = await storage.eventOccurrences.getAll(id);
      
      res.json({ ...event, occurrences });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });

  app.post("/api/events", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { occurrence, ...eventData } = req.body;
      
      const validation = insertEventSchema.safeParse(eventData);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      // Check if occurrence data is provided (required for new events)
      if (!occurrence || !occurrence.startAt || occurrence.startAt.trim() === "") {
        return res.status(400).json({ 
          message: "Start date and time is required for new events"
        });
      }
      
      // Validate the startAt is a valid date
      const startAtDate = new Date(occurrence.startAt);
      if (isNaN(startAtDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid start date/time format"
        });
      }
      
      // Build occurrence data and validate before creating event
      const occurrenceData = {
        eventId: "temp", // will be replaced after event creation
        startAt: occurrence.startAt,
        endAt: occurrence.endAt || null,
        status: occurrence.status || "active",
        notes: occurrence.notes || null,
      };
      
      // Pre-validate occurrence (except eventId which will be set after event creation)
      const occValidation = insertEventOccurrenceSchema.safeParse(occurrenceData);
      if (!occValidation.success) {
        return res.status(400).json({ 
          message: "Invalid occurrence data",
          errors: occValidation.error.errors 
        });
      }
      
      // Create the event
      const event = await storage.events.create(validation.data);
      
      // Create the first occurrence with the actual event ID
      try {
        const finalOccurrenceData = {
          ...occValidation.data,
          eventId: event.id,
        };
        await storage.eventOccurrences.create(finalOccurrenceData);
      } catch (occError) {
        // If occurrence creation fails, delete the event to maintain consistency
        console.error("Failed to create occurrence, rolling back event:", occError);
        await storage.events.delete(event.id);
        return res.status(500).json({ message: "Failed to create event occurrence" });
      }
      
      res.status(201).json(event);
    } catch (error: any) {
      console.error("Failed to create event:", error);
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  app.put("/api/events/:id", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = insertEventSchema.partial().safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const event = await storage.events.update(id, validation.data);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/events/:id", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.eventOccurrences.deleteByEventId(id);
      const deleted = await storage.events.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  app.get("/api/events/:id/occurrences", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const occurrences = await storage.eventOccurrences.getAll(id);
      res.json(occurrences);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch occurrences" });
    }
  });

  app.post("/api/events/:id/occurrences", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }

      // Helper to convert date strings to Date objects
      const parseOccurrenceData = (occ: any) => ({
        ...occ,
        eventId: id,
        startAt: occ.startAt ? new Date(occ.startAt) : undefined,
        endAt: occ.endAt ? new Date(occ.endAt) : null,
      });

      if (Array.isArray(req.body)) {
        const occurrences = req.body.map(parseOccurrenceData);
        
        for (const occ of occurrences) {
          const validation = insertEventOccurrenceSchema.safeParse(occ);
          if (!validation.success) {
            return res.status(400).json({ 
              message: "Invalid occurrence data",
              errors: validation.error.errors 
            });
          }
        }
        
        const created = await storage.eventOccurrences.createMany(occurrences);
        res.status(201).json(created);
      } else {
        const occurrenceData = parseOccurrenceData(req.body);
        const validation = insertEventOccurrenceSchema.safeParse(occurrenceData);
        
        if (!validation.success) {
          return res.status(400).json({ 
            message: "Invalid occurrence data",
            errors: validation.error.errors 
          });
        }
        
        const occurrence = await storage.eventOccurrences.create(validation.data);
        res.status(201).json(occurrence);
      }
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create occurrence" });
    }
  });

  app.put("/api/events/:eventId/occurrences/:occId", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { eventId, occId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventOccurrences.get(occId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Occurrence not found" });
        return;
      }
      
      // Convert date strings to Date objects
      const updateData = {
        ...req.body,
        ...(req.body.startAt && { startAt: new Date(req.body.startAt) }),
        ...(req.body.endAt && { endAt: new Date(req.body.endAt) }),
      };
      
      const validation = insertEventOccurrenceSchema.partial().safeParse(updateData);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid occurrence data",
          errors: validation.error.errors 
        });
      }
      
      const occurrence = await storage.eventOccurrences.update(occId, validation.data);
      res.json(occurrence);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update occurrence" });
    }
  });

  app.delete("/api/events/:eventId/occurrences/:occId", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { eventId, occId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventOccurrences.get(occId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Occurrence not found" });
        return;
      }
      
      await storage.eventOccurrences.delete(occId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete occurrence" });
    }
  });

  // ==================== PARTICIPANT ROUTES ====================

  // Get all participants for an event
  app.get("/api/events/:id/participants", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const event = await storage.events.get(id);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const participants = await storage.eventParticipants.getByEventId(id);
      res.json(participants);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch participants" });
    }
  });

  // Register a participant for an event
  app.post("/api/events/:id/register", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const event = await storage.events.get(id);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      // Get the event type to determine category
      const eventType = await storage.options.eventTypes.get(event.eventTypeId);
      if (!eventType) {
        res.status(400).json({ message: "Event type not found" });
        return;
      }
      
      const categoryId = eventType.category;
      const { contactId, role = "member", status = "attended" } = req.body;
      
      if (!contactId) {
        res.status(400).json({ message: "contactId is required" });
        return;
      }
      
      // Validate role and status against category
      if (!validateParticipantRole(categoryId, role)) {
        res.status(400).json({ message: `Invalid role '${role}' for category '${categoryId}'` });
        return;
      }
      
      if (!validateParticipantStatus(categoryId, status)) {
        res.status(400).json({ message: `Invalid status '${status}' for category '${categoryId}'` });
        return;
      }
      
      // Check if participant already exists
      const existing = await storage.eventParticipants.getByEventAndContact(id, contactId);
      if (existing) {
        res.status(400).json({ message: "Contact is already registered for this event" });
        return;
      }
      
      const participantData = {
        eventId: id,
        contactId,
        role,
        status,
      };
      
      const validation = insertEventParticipantSchema.safeParse(participantData);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid participant data",
          errors: validation.error.errors 
        });
      }
      
      const participant = await storage.eventParticipants.create(validation.data);
      
      // Execute charge plugins for participant save (fire-and-forget, errors logged internally)
      void executeParticipantChargePlugins(
        participant.id,
        id,
        event.eventTypeId,
        contactId,
        role,
        status
      );
      
      res.status(201).json(participant);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to register participant" });
    }
  });

  // Update a participant's status
  app.patch("/api/events/:eventId/participants/:participantId", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { eventId, participantId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventParticipants.get(participantId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Participant not found" });
        return;
      }
      
      // Get category for validation
      const eventType = await storage.options.eventTypes.get(event.eventTypeId);
      const categoryId = eventType?.category || "public";
      
      const { role, status } = req.body;
      
      if (role && !validateParticipantRole(categoryId, role)) {
        res.status(400).json({ message: `Invalid role '${role}' for category '${categoryId}'` });
        return;
      }
      
      if (status && !validateParticipantStatus(categoryId, status)) {
        res.status(400).json({ message: `Invalid status '${status}' for category '${categoryId}'` });
        return;
      }
      
      const updateData: { role?: string; status?: string } = {};
      if (role) updateData.role = role;
      if (status) updateData.status = status;
      
      const participant = await storage.eventParticipants.update(participantId, updateData);
      
      // Execute charge plugins for participant update (fire-and-forget, errors logged internally)
      if (participant) {
        void executeParticipantChargePlugins(
          participantId,
          eventId,
          event.eventTypeId,
          existing.contactId,
          participant.role,
          participant.status
        );
      }
      
      res.json(participant);
    } catch (error) {
      res.status(500).json({ message: "Failed to update participant" });
    }
  });

  // Remove a participant from an event
  app.delete("/api/events/:eventId/participants/:participantId", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { eventId, participantId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventParticipants.get(participantId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Participant not found" });
        return;
      }
      
      await storage.eventParticipants.delete(participantId);
      
      // Execute charge plugins with null status to clean up any ledger entries (fire-and-forget, errors logged internally)
      void executeParticipantChargePlugins(
        participantId,
        eventId,
        event.eventTypeId,
        existing.contactId,
        existing.role,
        null
      );
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  // Helper to get contactId for current user
  async function getUserContactId(req: any): Promise<string | null> {
    const user = (req as any).user;
    if (!user?.dbUser?.email) return null;
    
    const email = user.dbUser.email;
    const contact = await storage.contacts.getContactByEmail(email);
    return contact?.id || null;
  }

  // Helper to execute charge plugins after participant save
  async function executeParticipantChargePlugins(
    participantId: string,
    eventId: string,
    eventTypeId: string,
    contactId: string,
    role: string,
    status: string | null
  ): Promise<void> {
    try {
      const worker = await storage.workers.getWorkerByContactId(contactId);
      const workerId = worker?.id || null;
      const isSteward = workerId ? await storage.workerStewardAssignments.isWorkerSteward(workerId) : false;

      const context: ParticipantSavedContext = {
        trigger: TriggerType.PARTICIPANT_SAVED,
        participantId,
        eventId,
        eventTypeId,
        contactId,
        role,
        status,
        workerId,
        isSteward,
      };

      const result = await executeChargePlugins(context);
      
      if (result.totalTransactions.length > 0 || (result.notifications && result.notifications.length > 0)) {
        logger.info("Charge plugins executed for participant", {
          service: "events",
          participantId,
          transactionCount: result.totalTransactions.length,
          notificationCount: result.notifications?.length || 0,
        });
      }
    } catch (error) {
      logger.error("Failed to execute charge plugins for participant", {
        service: "events",
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get current user's self-registration for an event
  app.get("/api/events/:id/self-registration", eventComponent, requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      const event = await storage.events.get(id);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      // Get the event type to check if it's a membership event
      const eventType = await storage.options.eventTypes.get(event.eventTypeId);
      if (!eventType || eventType.category !== "membership") {
        res.status(400).json({ message: "Self-registration is only available for membership events" });
        return;
      }
      
      const contactId = await getUserContactId(req);
      if (!contactId) {
        res.status(400).json({ message: "Your account is not linked to a contact record" });
        return;
      }
      
      const registration = await storage.eventParticipants.getByEventAndContact(id, contactId);
      res.json(registration || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to get self-registration" });
    }
  });

  // Self-register for an event
  app.post("/api/events/:id/self-register", eventComponent, requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      const event = await storage.events.get(id);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      // Get the event type to check if it's a membership event
      const eventType = await storage.options.eventTypes.get(event.eventTypeId);
      if (!eventType || eventType.category !== "membership") {
        res.status(400).json({ message: "Self-registration is only available for membership events" });
        return;
      }
      
      const contactId = await getUserContactId(req);
      if (!contactId) {
        res.status(400).json({ message: "Your account is not linked to a contact record" });
        return;
      }
      
      // Check if already registered
      const existing = await storage.eventParticipants.getByEventAndContact(id, contactId);
      if (existing) {
        res.status(400).json({ message: "You are already registered for this event" });
        return;
      }
      
      const participantData = {
        eventId: id,
        contactId,
        role: "member",
        status: "attended",
      };
      
      const validation = insertEventParticipantSchema.safeParse(participantData);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid participant data",
          errors: validation.error.errors 
        });
      }
      
      const participant = await storage.eventParticipants.create(validation.data);
      
      // Execute charge plugins for participant save (fire-and-forget, errors logged internally)
      void executeParticipantChargePlugins(
        participant.id,
        id,
        event.eventTypeId,
        contactId,
        "member",
        "attended"
      );
      
      res.status(201).json(participant);
    } catch (error) {
      res.status(500).json({ message: "Failed to self-register" });
    }
  });

  // Update self-registration status
  app.patch("/api/events/:id/self-register", eventComponent, requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!status || !["attended", "canceled"].includes(status)) {
        res.status(400).json({ message: "Status must be 'attended' or 'canceled'" });
        return;
      }
      
      const event = await storage.events.get(id);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      // Get the event type to check if it's a membership event
      const eventType = await storage.options.eventTypes.get(event.eventTypeId);
      if (!eventType || eventType.category !== "membership") {
        res.status(400).json({ message: "Self-registration is only available for membership events" });
        return;
      }
      
      const contactId = await getUserContactId(req);
      if (!contactId) {
        res.status(400).json({ message: "Your account is not linked to a contact record" });
        return;
      }
      
      const existing = await storage.eventParticipants.getByEventAndContact(id, contactId);
      if (!existing) {
        res.status(404).json({ message: "You are not registered for this event" });
        return;
      }
      
      const participant = await storage.eventParticipants.update(existing.id, { status });
      
      // Execute charge plugins for participant update (fire-and-forget, errors logged internally)
      if (participant) {
        void executeParticipantChargePlugins(
          existing.id,
          id,
          event.eventTypeId,
          contactId,
          existing.role,
          status
        );
      }
      
      res.json(participant);
    } catch (error) {
      res.status(500).json({ message: "Failed to update registration" });
    }
  });
}

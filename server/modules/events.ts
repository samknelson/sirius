import type { Express } from "express";
import { storage } from "../storage";
import { insertEventSchema, insertEventOccurrenceSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { requireComponent } from "./components";

export function registerEventsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const eventComponent = requireComponent("event");

  app.get("/api/events", eventComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const events = await storage.events.getAll();
      res.json(events);
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
}

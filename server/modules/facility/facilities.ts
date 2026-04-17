import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import type { FacilityFilters } from "../../storage/facility/facilities";

// Note: `siriusId` and `data` are sync-only fields, populated programmatically
// by backend processes (e.g. T631 sync). They are intentionally NOT part of
// user-editable create/update payloads.
const createFacilitySchema = z
  .object({
    name: z.string().trim().min(1, "Facility name is required"),
  })
  .strict();

const nameComponentsSchema = z
  .object({
    title: z.string().optional(),
    given: z.string().optional(),
    middle: z.string().optional(),
    family: z.string().optional(),
    generational: z.string().optional(),
    credentials: z.string().optional(),
  })
  .strict();

const updateFacilitySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    nameComponents: nameComponentsSchema.optional(),
    email: z
      .union([z.string().email(), z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
  })
  .strict();

export function registerFacilityRoutes(
  app: Express,
  requireAuth: any,
  _requirePermission: any,
) {
  const facilityComponent = requireComponent("facility");

  app.get(
    "/api/facilities",
    facilityComponent,
    requireAuth,
    requireAccess('facility.view'),
    async (req, res) => {
      try {
        const { search, contactId, sortDir, page: pageParam, limit: limitParam } = req.query;
        const page = parseInt(pageParam as string) || 0;
        const limit = Math.min(parseInt(limitParam as string) || 50, 100);

        const filters: FacilityFilters = { sort: 'name' };
        if (typeof search === "string" && search) filters.search = search;
        if (typeof contactId === "string" && contactId) filters.contactId = contactId;
        if (typeof sortDir === "string" && (sortDir === 'asc' || sortDir === 'desc')) {
          filters.sortDir = sortDir;
        }

        const result = await storage.facilities.getPaginated(page, limit, filters);
        res.json(result);
      } catch (error) {
        console.error("Failed to fetch facilities:", error);
        res.status(500).json({ message: "Failed to fetch facilities" });
      }
    },
  );

  app.get(
    "/api/facilities/:id",
    facilityComponent,
    requireAuth,
    requireAccess('facility.view', (req) => req.params.id),
    async (req, res) => {
      try {
        const facility = await storage.facilities.getWithContact(req.params.id);
        if (!facility) {
          return res.status(404).json({ message: "Facility not found" });
        }
        res.json(facility);
      } catch (error) {
        console.error("Failed to fetch facility:", error);
        res.status(500).json({ message: "Failed to fetch facility" });
      }
    },
  );

  app.post(
    "/api/facilities",
    facilityComponent,
    requireAuth,
    requireAccess('facility.edit'),
    async (req, res) => {
      try {
        const parsed = createFacilitySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        const facility = await storage.facilities.create(parsed.data);
        res.status(201).json(facility);
      } catch (error) {
        console.error("Failed to create facility:", error);
        res.status(500).json({ message: "Failed to create facility" });
      }
    },
  );

  app.patch(
    "/api/facilities/:id",
    facilityComponent,
    requireAuth,
    requireAccess('facility.edit', (req) => req.params.id),
    async (req, res) => {
      try {
        const parsed = updateFacilitySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        if (Object.keys(parsed.data).length === 0) {
          return res.status(400).json({ message: "No fields to update" });
        }
        const { email, name, nameComponents } = parsed.data;

        let facility = await storage.facilities.get(req.params.id);
        if (!facility) {
          return res.status(404).json({ message: "Facility not found" });
        }

        if (nameComponents !== undefined) {
          facility = await storage.facilities.updateContactNameComponents(
            req.params.id,
            nameComponents,
          );
          if (!facility) {
            return res.status(404).json({ message: "Facility not found" });
          }
        } else if (name !== undefined) {
          facility = await storage.facilities.updateContactName(req.params.id, name);
          if (!facility) {
            return res.status(404).json({ message: "Facility not found" });
          }
        }

        if (email !== undefined) {
          facility = await storage.facilities.updateContactEmail(req.params.id, email);
        }

        const result = await storage.facilities.getWithContact(req.params.id);
        res.json(result);
      } catch (error) {
        console.error("Failed to update facility:", error);
        res.status(500).json({ message: "Failed to update facility" });
      }
    },
  );

  app.delete(
    "/api/facilities/:id",
    facilityComponent,
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const deleted = await storage.facilities.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Facility not found" });
        }
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to delete facility:", error);
        res.status(500).json({ message: "Failed to delete facility" });
      }
    },
  );

  app.get(
    "/api/facilities/:id/logs",
    facilityComponent,
    requireAuth,
    requireAccess('facility.view', (req) => req.params.id),
    async (req, res) => {
      try {
        const facility = await storage.facilities.get(req.params.id);
        if (!facility) {
          return res.status(404).json({ message: "Facility not found" });
        }
        const { module, operation, startDate, endDate } = req.query;
        const hostEntityIds: string[] = [facility.id];
        if (facility.contactId) hostEntityIds.push(facility.contactId);

        const logs = await storage.logs.getLogsByHostEntityIds({
          hostEntityIds,
          module: typeof module === 'string' ? module : undefined,
          operation: typeof operation === 'string' ? operation : undefined,
          startDate: typeof startDate === 'string' ? startDate : undefined,
          endDate: typeof endDate === 'string' ? endDate : undefined,
        });
        res.json(logs);
      } catch (error) {
        console.error("Failed to fetch facility logs:", error);
        res.status(500).json({ message: "Failed to fetch facility logs" });
      }
    },
  );
}

import type { Express } from "express";
import { storage } from "../../storage";
import { insertFacilitySchema } from "@shared/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import type { FacilityFilters } from "../../storage/facility/facilities";

export function registerFacilityRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
) {
  const facilityComponent = requireComponent("facility");

  app.get(
    "/api/facilities",
    facilityComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const {
          search,
          contactId,
          sortDir,
          page: pageParam,
          limit: limitParam,
        } = req.query;

        const page = parseInt(pageParam as string) || 0;
        const limit = Math.min(parseInt(limitParam as string) || 50, 100);

        const filters: FacilityFilters = { sort: 'name' };
        if (search && typeof search === "string") {
          filters.search = search;
        }
        if (contactId && typeof contactId === "string") {
          filters.contactId = contactId;
        }
        if (sortDir && typeof sortDir === "string" && ['asc', 'desc'].includes(sortDir)) {
          filters.sortDir = sortDir as 'asc' | 'desc';
        }

        const result = await storage.facilities.getPaginated(page, limit, filters);
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch facilities" });
      }
    },
  );

  app.get(
    "/api/facilities/:id",
    facilityComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const facility = await storage.facilities.get(req.params.id);
        if (!facility) {
          return res.status(404).json({ message: "Facility not found" });
        }
        res.json(facility);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch facility" });
      }
    },
  );

  app.post(
    "/api/facilities",
    facilityComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertFacilitySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        const facility = await storage.facilities.create(parsed.data);
        res.status(201).json(facility);
      } catch (error) {
        res.status(500).json({ message: "Failed to create facility" });
      }
    },
  );

  app.put(
    "/api/facilities/:id",
    facilityComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertFacilitySchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        if (Object.keys(parsed.data).length === 0) {
          return res.status(400).json({ message: "No fields to update" });
        }
        const facility = await storage.facilities.update(req.params.id, parsed.data);
        if (!facility) {
          return res.status(404).json({ message: "Facility not found" });
        }
        res.json(facility);
      } catch (error) {
        res.status(500).json({ message: "Failed to update facility" });
      }
    },
  );

  app.delete(
    "/api/facilities/:id",
    facilityComponent,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const deleted = await storage.facilities.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Facility not found" });
        }
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete facility" });
      }
    },
  );
}

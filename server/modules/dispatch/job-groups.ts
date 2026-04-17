import type { Express } from "express";
import { storage } from "../../storage";
import { insertDispatchJobGroupSchema } from "@shared/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import type { DispatchJobGroupFilters } from "../../storage/dispatch/job-groups";

export function registerDispatchJobGroupsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
) {
  const jobGroupComponent = requireComponent("dispatch.job_group");

  app.get(
    "/api/dispatch-job-groups",
    jobGroupComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const {
          search,
          active,
          date,
          sort,
          sortDir,
          page: pageParam,
          limit: limitParam,
        } = req.query;

        const page = parseInt(pageParam as string) || 0;
        const limit = Math.min(parseInt(limitParam as string) || 50, 100);

        const filters: DispatchJobGroupFilters = {};
        if (search && typeof search === "string") {
          filters.search = search;
        }
        if (date && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          filters.date = date;
        }
        if (active && typeof active === "string" && ['active', 'inactive', 'all'].includes(active)) {
          filters.active = active as 'active' | 'inactive' | 'all';
        }
        if (sort && typeof sort === "string" && ['name', 'startYmd'].includes(sort)) {
          filters.sort = sort as 'name' | 'startYmd';
        }
        if (sortDir && typeof sortDir === "string" && ['asc', 'desc'].includes(sortDir)) {
          filters.sortDir = sortDir as 'asc' | 'desc';
        }

        const result = await storage.dispatchJobGroups.getPaginated(page, limit, filters);
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch dispatch job groups" });
      }
    },
  );

  app.get(
    "/api/dispatch-job-groups/:id",
    jobGroupComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const group = await storage.dispatchJobGroups.get(req.params.id);
        if (!group) {
          return res.status(404).json({ message: "Job group not found" });
        }
        res.json(group);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch job group" });
      }
    },
  );

  app.post(
    "/api/dispatch-job-groups",
    jobGroupComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertDispatchJobGroupSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        const group = await storage.dispatchJobGroups.create(parsed.data);
        res.status(201).json(group);
      } catch (error) {
        res.status(500).json({ message: "Failed to create job group" });
      }
    },
  );

  app.put(
    "/api/dispatch-job-groups/:id",
    jobGroupComponent,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertDispatchJobGroupSchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Validation error: ${parsed.error.errors.map(e => e.message).join(", ")}`,
          });
        }
        if (Object.keys(parsed.data).length === 0) {
          return res.status(400).json({ message: "No fields to update" });
        }
        const group = await storage.dispatchJobGroups.update(req.params.id, parsed.data);
        if (!group) {
          return res.status(404).json({ message: "Job group not found" });
        }
        res.json(group);
      } catch (error) {
        res.status(500).json({ message: "Failed to update job group" });
      }
    },
  );

  app.delete(
    "/api/dispatch-job-groups/:id",
    jobGroupComponent,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const deleted = await storage.dispatchJobGroups.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Job group not found" });
        }
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete job group" });
      }
    },
  );
}

import type { Express } from "express";
import { storage } from "../storage";
import { insertEdlsTaskSchema } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";

export function registerEdlsTasksRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const edlsComponent = requireComponent("edls");

  app.get("/api/edls/tasks", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const tasks = await storage.edlsTasks.getAll();
      res.json(tasks);
    } catch (error) {
      console.error("Failed to fetch EDLS tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      const task = await storage.edlsTasks.get(id);
      
      if (!task) {
        res.status(404).json({ message: "Task not found" });
        return;
      }
      
      res.json(task);
    } catch (error) {
      console.error("Failed to fetch EDLS task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post("/api/edls/tasks", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const parseResult = insertEdlsTaskSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        res.status(400).json({ 
          message: "Invalid task data", 
          errors: parseResult.error.flatten() 
        });
        return;
      }
      
      const task = await storage.edlsTasks.create(parseResult.data);
      res.status(201).json(task);
    } catch (error) {
      console.error("Failed to create EDLS task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.put("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      const parseResult = insertEdlsTaskSchema.partial().safeParse(req.body);
      
      if (!parseResult.success) {
        res.status(400).json({ 
          message: "Invalid task data", 
          errors: parseResult.error.flatten() 
        });
        return;
      }
      
      const task = await storage.edlsTasks.update(id, parseResult.data);
      
      if (!task) {
        res.status(404).json({ message: "Task not found" });
        return;
      }
      
      res.json(task);
    } catch (error) {
      console.error("Failed to update EDLS task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.edlsTasks.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Task not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete EDLS task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });
}

import type { Express } from "express";
import { insertEdlsTaskSchema } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { getOptionsType } from "./options-registry";

export function registerEdlsTasksRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const edlsComponent = requireComponent("edls");
  
  const getEdlsTaskOptions = () => {
    const config = getOptionsType("edls-task");
    if (!config) throw new Error("edls-task options type not configured");
    return config;
  };

  app.get("/api/edls/tasks/options", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const tasks = await getEdlsTaskOptions().getAll();
      res.json(tasks.map((t: any) => ({ id: t.id, name: t.name, departmentId: t.departmentId })));
    } catch (error) {
      console.error("Failed to fetch EDLS task options:", error);
      res.status(500).json({ message: "Failed to fetch task options" });
    }
  });

  app.get("/api/edls/tasks", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
    try {
      const tasks = await getEdlsTaskOptions().getAll();
      res.json(tasks);
    } catch (error) {
      console.error("Failed to fetch EDLS tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const task = await getEdlsTaskOptions().get(id);
      
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

  app.post("/api/edls/tasks", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
    try {
      const parseResult = insertEdlsTaskSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        res.status(400).json({ 
          message: "Invalid task data", 
          errors: parseResult.error.flatten() 
        });
        return;
      }
      
      const task = await getEdlsTaskOptions().create(parseResult.data);
      res.status(201).json(task);
    } catch (error) {
      console.error("Failed to create EDLS task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.put("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
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
      
      const task = await getEdlsTaskOptions().update(id, parseResult.data);
      
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

  app.delete("/api/edls/tasks/:id", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await getEdlsTaskOptions().delete(id);
      
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

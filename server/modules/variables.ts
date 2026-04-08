import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertVariableSchema } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerVariableRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  app.get("/api/variables", requireAccess('admin'), async (req, res) => {
    try {
      const variables = await storage.variables.getAll();
      res.json(variables);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variables" });
    }
  });

  app.get("/api/variables/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const variable = await storage.variables.get(id);
      
      if (!variable) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }
      
      res.json(variable);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variable" });
    }
  });

  app.get("/api/variables/by-name/:name", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const variable = await storage.variables.getByName(name);
      
      if (!variable) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }
      
      res.json(variable);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variable" });
    }
  });

  app.post("/api/variables", requireAccess('admin'), async (req, res) => {
    try {
      const validatedData = insertVariableSchema.parse(req.body);
      
      const existingVariable = await storage.variables.getByName(validatedData.name);
      if (existingVariable) {
        res.status(409).json({ message: "Variable name already exists" });
        return;
      }
      
      const variable = await storage.variables.create(validatedData);
      res.status(201).json(variable);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid variable data" });
      } else if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to create variable" });
      }
    }
  });

  app.put("/api/variables/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertVariableSchema.partial().parse(req.body);
      
      if (validatedData.name) {
        const existingVariable = await storage.variables.getByName(validatedData.name);
        if (existingVariable && existingVariable.id !== id) {
          res.status(409).json({ message: "Variable name already exists" });
          return;
        }
      }
      
      const variable = await storage.variables.update(id, validatedData);
      
      if (!variable) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }
      
      res.json(variable);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid variable data" });
      } else if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to update variable" });
      }
    }
  });

  app.delete("/api/variables/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.variables.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete variable" });
    }
  });
}

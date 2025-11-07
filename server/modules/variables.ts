import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertVariableSchema } from "@shared/schema";

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerVariableRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Variable routes (protected with authentication and permissions)
  
  // GET /api/variables - Get all variables (requires variables.manage permission)
  app.get("/api/variables", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const variables = await storage.variables.getAll();
      res.json(variables);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variables" });
    }
  });

  // GET /api/variables/:id - Get a specific variable (requires variables.manage permission)
  app.get("/api/variables/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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

  // GET /api/variables/by-name/:name - Get a variable by name (requires variables.manage permission)
  app.get("/api/variables/by-name/:name", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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

  // POST /api/variables - Create a new variable (requires variables.manage permission)
  app.post("/api/variables", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const validatedData = insertVariableSchema.parse(req.body);
      
      // Check if variable name already exists
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
        // PostgreSQL unique constraint violation
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to create variable" });
      }
    }
  });

  // PUT /api/variables/:id - Update a variable (requires variables.manage permission)
  app.put("/api/variables/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertVariableSchema.partial().parse(req.body);
      
      // If updating name, check for conflicts
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
        // PostgreSQL unique constraint violation
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to update variable" });
      }
    }
  });

  // DELETE /api/variables/:id - Delete a variable (requires variables.manage permission)
  app.delete("/api/variables/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertWorkerSchema, 
  insertVariableSchema
} from "@shared/schema";
import { registerUserRoutes } from "./modules/users";

// Session type extension
declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

// Authentication middleware
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};

// Permission middleware
const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    const hasPermission = await storage.userHasPermission(req.session.userId, permissionKey);
    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    
    next();
  };
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Register user management routes
  registerUserRoutes(app, requireAuth, requirePermission);

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers - Get all workers (requires workers.view permission)
  app.get("/api/workers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/:id - Get a specific worker (requires workers.view permission)
  app.get("/api/workers/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const worker = await storage.getWorker(id);
      
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker" });
    }
  });

  // POST /api/workers - Create a new worker (requires workers.manage permission)
  app.post("/api/workers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const validatedData = insertWorkerSchema.parse(req.body);
      const worker = await storage.createWorker(validatedData);
      res.status(201).json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to create worker" });
      }
    }
  });

  // PUT /api/workers/:id - Update a worker (requires workers.manage permission)
  app.put("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertWorkerSchema.partial().parse(req.body);
      const worker = await storage.updateWorker(id, validatedData);
      
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to update worker" });
      }
    }
  });

  // DELETE /api/workers/:id - Delete a worker (requires workers.manage permission)
  app.delete("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteWorker(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker" });
    }
  });

  // Variable routes (protected with authentication and permissions)
  
  // GET /api/variables - Get all variables (requires variables.manage permission)
  app.get("/api/variables", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const variables = await storage.getAllVariables();
      res.json(variables);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variables" });
    }
  });

  // GET /api/variables/:id - Get a specific variable (requires variables.manage permission)
  app.get("/api/variables/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const variable = await storage.getVariable(id);
      
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
      const existingVariable = await storage.getVariableByName(validatedData.name);
      if (existingVariable) {
        res.status(409).json({ message: "Variable name already exists" });
        return;
      }
      
      const variable = await storage.createVariable(validatedData);
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
        const existingVariable = await storage.getVariableByName(validatedData.name);
        if (existingVariable && existingVariable.id !== id) {
          res.status(409).json({ message: "Variable name already exists" });
          return;
        }
      }
      
      const variable = await storage.updateVariable(id, validatedData);
      
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
      const deleted = await storage.deleteVariable(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete variable" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

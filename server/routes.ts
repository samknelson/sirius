import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema } from "@shared/schema";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerPostalAddressRoutes } from "./modules/postal-addresses";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import { addressValidationService } from "./services/address-validation";

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
  
  // Register postal address management routes
  registerPostalAddressRoutes(app, requireAuth, requirePermission);
  
  // Register address validation routes
  registerAddressValidationRoutes(app, requireAuth, requirePermission);

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

  // IMPORTANT: Register specific variable routes BEFORE generic variable routes
  // GET /api/variables/address_validation_config - Get address validation configuration
  app.get("/api/variables/address_validation_config", requireAuth, async (req, res) => {
    try {
      const config = await addressValidationService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch address validation configuration" });
    }
  });

  // PUT /api/variables/address_validation_config - Update address validation configuration
  app.put("/api/variables/address_validation_config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      // Basic validation for the configuration update
      const { mode, local, google } = req.body;
      
      if (!mode || (mode !== "local" && mode !== "google")) {
        return res.status(400).json({ message: "Invalid validation mode. Must be 'local' or 'google'." });
      }
      
      if (!local || typeof local.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid local configuration." });
      }
      
      if (!google || typeof google.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid google configuration." });
      }
      
      await addressValidationService.updateConfig(req.body);
      const updatedConfig = await addressValidationService.getConfig();
      res.json(updatedConfig);
    } catch (error) {
      res.status(500).json({ message: "Failed to update address validation configuration" });
    }
  });

  // POST /api/geocode - Geocode an address
  app.post("/api/geocode", requireAuth, async (req, res) => {
    try {
      const { street, city, state, postalCode, country } = req.body;
      
      const result = await addressValidationService.geocodeAddress({
        street: street || "",
        city: city || "",
        state: state || "",
        postalCode: postalCode || "",
        country: country || "",
      });
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: "Failed to geocode address" 
      });
    }
  });

  // Register generic variable management routes (MUST come after specific routes)
  registerVariableRoutes(app, requireAuth, requirePermission);


  const httpServer = createServer(app);
  return httpServer;
}

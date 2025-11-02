import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema } from "@shared/schema";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerPostalAddressRoutes } from "./modules/postal-addresses";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import { addressValidationService } from "./services/address-validation";
import { phoneValidationService } from "./services/phone-validation";

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
  
  // Register phone number management routes
  registerPhoneNumberRoutes(app, requireAuth, requirePermission);
  
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
      const { name } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Worker name is required" });
      }
      const worker = await storage.createWorker(name.trim());
      res.status(201).json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to create worker" });
    }
  });

  // PUT /api/workers/:id - Update a worker's contact name or SSN (requires workers.manage permission)
  app.put("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nameComponents, ssn } = req.body;
      
      // Handle SSN updates
      if (ssn !== undefined) {
        const worker = await storage.updateWorkerSSN(id, ssn);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Support both old format (name) and new format (nameComponents)
      else if (nameComponents) {
        // New format: name components
        const worker = await storage.updateWorkerContactNameComponents(id, nameComponents);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      } else if (name && typeof name === 'string' && name.trim()) {
        // Old format: simple name string (for backwards compatibility)
        const worker = await storage.updateWorkerContactName(id, name.trim());
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      } else {
        return res.status(400).json({ message: "Worker name, name components, or SSN are required" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to update worker" });
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

  // GET /api/contacts/:id - Get a contact by ID (requires workers.view permission)
  app.get("/api/contacts/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const contact = await storage.getContact(id);
      
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
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

  // GET /api/variables/phone_validation_config - Get phone validation configuration
  app.get("/api/variables/phone_validation_config", requireAuth, async (req, res) => {
    try {
      const config = await phoneValidationService.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone validation configuration" });
    }
  });

  // PUT /api/variables/phone_validation_config - Update phone validation configuration
  app.put("/api/variables/phone_validation_config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { mode, local, twilio, fallback } = req.body;
      
      console.log('Received phone validation config update:', JSON.stringify(req.body, null, 2));
      
      if (!mode || (mode !== "local" && mode !== "twilio")) {
        return res.status(400).json({ message: "Invalid validation mode. Must be 'local' or 'twilio'." });
      }
      
      if (!local || typeof local.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid local configuration." });
      }
      
      if (!twilio || typeof twilio.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid twilio configuration." });
      }
      
      if (!fallback || typeof fallback.useLocalOnTwilioFailure !== "boolean") {
        return res.status(400).json({ message: "Invalid fallback configuration." });
      }
      
      const configVar = await storage.getVariableByName('phone_validation_config');
      if (configVar) {
        console.log('Updating existing config variable:', configVar.id);
        await storage.updateVariable(configVar.id, {
          value: req.body,
        });
      } else {
        console.log('Creating new config variable');
        await storage.createVariable({
          name: 'phone_validation_config',
          value: req.body,
        });
      }
      
      const updatedConfig = await phoneValidationService.loadConfig();
      console.log('Loaded config after update:', JSON.stringify(updatedConfig, null, 2));
      res.json(updatedConfig);
    } catch (error) {
      console.error('Error updating phone validation config:', error);
      res.status(500).json({ 
        message: "Failed to update phone validation configuration",
        error: error instanceof Error ? error.message : String(error)
      });
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

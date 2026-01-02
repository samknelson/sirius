import type { Express } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";

export function registerWorkerIdsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  // GET /api/workers/:workerId/ids - Get all IDs for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/ids", requireAccess('worker.self', req => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const workerIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
      res.json(workerIds);
    } catch (error) {
      console.error("Error fetching worker IDs:", error);
      res.status(500).json({ message: "Failed to fetch worker IDs" });
    }
  });

  // GET /api/worker-ids/:id - Get a specific worker ID (requires workers.view permission)
  app.get("/api/worker-ids/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const workerId = await storage.workerIds.getWorkerId(id);
      
      if (!workerId) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.json(workerId);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID" });
    }
  });

  // POST /api/workers/:workerId/ids - Create a new worker ID (requires workers.manage permission)
  app.post("/api/workers/:workerId/ids", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { typeId, value } = req.body;
      
      if (!typeId || typeof typeId !== 'string' || !typeId.trim()) {
        return res.status(400).json({ message: "Type ID is required" });
      }
      
      if (!value || typeof value !== 'string' || !value.trim()) {
        return res.status(400).json({ message: "Value is required" });
      }
      
      // Verify the worker exists
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Verify the type exists
      const type = await storage.options.workerIdTypes.getWorkerIdType(typeId);
      if (!type) {
        return res.status(404).json({ message: "Worker ID type not found" });
      }
      
      // Validate against regex if type has a validator
      if (type.validator) {
        try {
          const regex = new RegExp(type.validator);
          if (!regex.test(value.trim())) {
            return res.status(400).json({ 
              message: `Value does not match the required format for ${type.name}` 
            });
          }
        } catch (regexError) {
          // If regex is invalid, log but don't block the creation
          console.error(`Invalid regex pattern for type ${type.name}:`, regexError);
        }
      }
      
      const newWorkerId = await storage.workerIds.createWorkerId({
        workerId,
        typeId: typeId.trim(),
        value: value.trim(),
      });
      
      res.status(201).json(newWorkerId);
    } catch (error: any) {
      console.error("Error creating worker ID:", error);
      
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'worker_ids_type_id_value_unique') {
        return res.status(409).json({ 
          message: "This ID value already exists for this type. Worker IDs must be unique." 
        });
      }
      
      res.status(500).json({ message: "Failed to create worker ID" });
    }
  });

  // PUT /api/worker-ids/:id - Update a worker ID (requires workers.manage permission)
  app.put("/api/worker-ids/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { typeId, value } = req.body;
      
      const updates: any = {};
      
      if (typeId !== undefined) {
        if (typeof typeId !== 'string' || !typeId.trim()) {
          return res.status(400).json({ message: "Type ID must be a non-empty string" });
        }
        
        // Verify the type exists
        const type = await storage.options.workerIdTypes.getWorkerIdType(typeId);
        if (!type) {
          return res.status(404).json({ message: "Worker ID type not found" });
        }
        
        updates.typeId = typeId.trim();
      }
      
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim()) {
          return res.status(400).json({ message: "Value must be a non-empty string" });
        }
        
        // Get the worker ID to check its type
        const existingWorkerId = await storage.workerIds.getWorkerId(id);
        if (!existingWorkerId) {
          return res.status(404).json({ message: "Worker ID not found" });
        }
        
        // Determine which type to validate against
        const typeToValidate = typeId ? typeId.trim() : existingWorkerId.typeId;
        const type = await storage.options.workerIdTypes.getWorkerIdType(typeToValidate);
        
        // Validate against regex if type has a validator
        if (type && type.validator) {
          try {
            const regex = new RegExp(type.validator);
            if (!regex.test(value.trim())) {
              return res.status(400).json({ 
                message: `Value does not match the required format for ${type.name}` 
              });
            }
          } catch (regexError) {
            console.error(`Invalid regex pattern for type ${type.name}:`, regexError);
          }
        }
        
        updates.value = value.trim();
      }
      
      const updatedWorkerId = await storage.workerIds.updateWorkerId(id, updates);
      
      if (!updatedWorkerId) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.json(updatedWorkerId);
    } catch (error: any) {
      console.error("Error updating worker ID:", error);
      
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'worker_ids_type_id_value_unique') {
        return res.status(409).json({ 
          message: "This ID value already exists for this type. Worker IDs must be unique." 
        });
      }
      
      res.status(500).json({ message: "Failed to update worker ID" });
    }
  });

  // DELETE /api/worker-ids/:id - Delete a worker ID (requires workers.manage permission)
  app.delete("/api/worker-ids/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workerIds.deleteWorkerId(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID" });
    }
  });
}

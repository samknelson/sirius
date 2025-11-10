import type { Express } from "express";
import { storage } from "../storage";
import { insertWorkerWsSchema, updateWorkerWsSchema, insertEmploymentStatusSchema, updateEmploymentStatusSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

export function registerOptionsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  // Worker ID Type routes
  
  // GET /api/worker-id-types - Get all worker ID types (requires workers.view permission)
  app.get("/api/worker-id-types", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workerIdTypes = await storage.options.workerIdTypes.getAllWorkerIdTypes();
      res.json(workerIdTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID types" });
    }
  });

  // GET /api/worker-id-types/:id - Get a specific worker ID type (requires workers.view permission)
  app.get("/api/worker-id-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const workerIdType = await storage.options.workerIdTypes.getWorkerIdType(id);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID type" });
    }
  });

  // POST /api/worker-id-types - Create a new worker ID type (requires admin permission)
  app.post("/api/worker-id-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, sequence, validator } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const workerIdType = await storage.options.workerIdTypes.createWorkerIdType({
        name: name.trim(),
        sequence: typeof sequence === 'number' ? sequence : 0,
        validator: validator && typeof validator === 'string' ? validator.trim() : null,
      });
      
      res.status(201).json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create worker ID type" });
    }
  });

  // PUT /api/worker-id-types/:id - Update a worker ID type (requires admin permission)
  app.put("/api/worker-id-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, sequence, validator } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      if (validator !== undefined) {
        if (validator === null || validator === '') {
          updates.validator = null;
        } else if (typeof validator === 'string') {
          updates.validator = validator.trim();
        } else {
          return res.status(400).json({ message: "Validator must be a string or null" });
        }
      }
      
      const workerIdType = await storage.options.workerIdTypes.updateWorkerIdType(id, updates);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update worker ID type" });
    }
  });

  // DELETE /api/worker-id-types/:id - Delete a worker ID type (requires admin permission)
  app.delete("/api/worker-id-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.workerIdTypes.deleteWorkerIdType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID type" });
    }
  });

  // Employer Contact Type routes

  // GET /api/employer-contact-types - Get all employer contact types (requires admin permission)
  app.get("/api/employer-contact-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const contactTypes = await storage.options.employerContactTypes.getAll();
      res.json(contactTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact types" });
    }
  });

  // GET /api/employer-contact-types/:id - Get a specific employer contact type (requires admin permission)
  app.get("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const contactType = await storage.options.employerContactTypes.get(id);
      
      if (!contactType) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact type" });
    }
  });

  // POST /api/employer-contact-types - Create a new employer contact type (requires admin permission)
  app.post("/api/employer-contact-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const contactType = await storage.options.employerContactTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
      });
      
      res.status(201).json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer contact type" });
    }
  });

  // PUT /api/employer-contact-types/:id - Update an employer contact type (requires admin permission)
  app.put("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (description !== undefined) {
        if (description === null || description === '') {
          updates.description = null;
        } else if (typeof description === 'string') {
          updates.description = description.trim();
        } else {
          return res.status(400).json({ message: "Description must be a string or null" });
        }
      }
      
      const contactType = await storage.options.employerContactTypes.update(id, updates);
      
      if (!contactType) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update employer contact type" });
    }
  });

  // DELETE /api/employer-contact-types/:id - Delete an employer contact type (requires admin permission)
  app.delete("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id} = req.params;
      const deleted = await storage.options.employerContactTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer contact type" });
    }
  });

  // Worker Work Status routes

  // GET /api/worker-work-statuses - Get all worker work statuses (requires admin permission)
  app.get("/api/worker-work-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const statuses = await storage.options.workerWs.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker work statuses" });
    }
  });

  // GET /api/worker-work-statuses/:id - Get a specific worker work status (requires admin permission)
  app.get("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const status = await storage.options.workerWs.get(id);
      
      if (!status) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker work status" });
    }
  });

  // POST /api/worker-work-statuses - Create a new worker work status (requires admin permission)
  app.post("/api/worker-work-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const validation = insertWorkerWsSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.workerWs.create(validation.data);
      
      res.status(201).json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create worker work status" });
    }
  });

  // PUT /api/worker-work-statuses/:id - Update a worker work status (requires admin permission)
  app.put("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateWorkerWsSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.workerWs.update(id, validation.data);
      
      if (!status) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update worker work status" });
    }
  });

  // DELETE /api/worker-work-statuses/:id - Delete a worker work status (requires admin permission)
  app.delete("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.workerWs.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker work status" });
    }
  });

  // Employment Status routes

  // GET /api/employment-statuses - Get all employment statuses (requires admin permission)
  app.get("/api/employment-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const statuses = await storage.options.employmentStatus.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment statuses" });
    }
  });

  // GET /api/employment-statuses/:id - Get a specific employment status (requires admin permission)
  app.get("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const status = await storage.options.employmentStatus.get(id);
      
      if (!status) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment status" });
    }
  });

  // POST /api/employment-statuses - Create a new employment status (requires admin permission)
  app.post("/api/employment-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const validation = insertEmploymentStatusSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.employmentStatus.create(validation.data);
      res.status(201).json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employment status" });
    }
  });

  // PUT /api/employment-statuses/:id - Update an employment status (requires admin permission)
  app.put("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateEmploymentStatusSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.employmentStatus.update(id, validation.data);
      
      if (!status) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update employment status" });
    }
  });

  // DELETE /api/employment-statuses/:id - Delete an employment status (requires admin permission)
  app.delete("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.employmentStatus.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employment status" });
    }
  });

  // Ledger Payment Type routes

  // GET /api/ledger-payment-types - Get all ledger payment types (requires ledgerStaff policy)
  app.get("/api/ledger-payment-types", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const paymentTypes = await storage.options.ledgerPaymentTypes.getAllLedgerPaymentTypes();
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger payment types" });
    }
  });

  // GET /api/ledger-payment-types/:id - Get a specific ledger payment type (requires ledgerStaff policy)
  app.get("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const paymentType = await storage.options.ledgerPaymentTypes.getLedgerPaymentType(id);
      
      if (!paymentType) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.json(paymentType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger payment type" });
    }
  });

  // POST /api/ledger-payment-types - Create a new ledger payment type (requires ledgerStaff policy)
  app.post("/api/ledger-payment-types", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { name, description, sequence } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const paymentType = await storage.options.ledgerPaymentTypes.createLedgerPaymentType({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        sequence: typeof sequence === 'number' ? sequence : 0,
      });
      
      res.status(201).json(paymentType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create ledger payment type" });
    }
  });

  // PUT /api/ledger-payment-types/:id - Update a ledger payment type (requires ledgerStaff policy)
  app.put("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sequence } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (description !== undefined) {
        if (description === null || description === '') {
          updates.description = null;
        } else if (typeof description === 'string') {
          updates.description = description.trim();
        } else {
          return res.status(400).json({ message: "Description must be a string or null" });
        }
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      const paymentType = await storage.options.ledgerPaymentTypes.updateLedgerPaymentType(id, updates);
      
      if (!paymentType) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.json(paymentType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update ledger payment type" });
    }
  });

  // DELETE /api/ledger-payment-types/:id - Delete a ledger payment type (requires ledgerStaff policy)
  app.delete("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.ledgerPaymentTypes.deleteLedgerPaymentType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ledger payment type" });
    }
  });

  // Gender Options routes

  // GET /api/gender-options - Get all gender options (requires workers.view permission)
  app.get("/api/gender-options", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const genderOptions = await storage.options.gender.getAllGenderOptions();
      res.json(genderOptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender options" });
    }
  });

  // GET /api/gender-options/:id - Get a specific gender option (requires workers.view permission)
  app.get("/api/gender-options/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const genderOption = await storage.options.gender.getGenderOption(id);
      
      if (!genderOption) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.json(genderOption);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender option" });
    }
  });

  // POST /api/gender-options - Create a new gender option (requires admin permission)
  app.post("/api/gender-options", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, code, nota, sequence } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: "Code is required" });
      }
      
      const genderOption = await storage.options.gender.createGenderOption({
        name: name.trim(),
        code: code.trim(),
        nota: typeof nota === 'boolean' ? nota : false,
        sequence: typeof sequence === 'number' ? sequence : 0,
      });
      
      res.status(201).json(genderOption);
    } catch (error: any) {
      if (error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(409).json({ message: "A gender option with this code already exists" });
      }
      res.status(500).json({ message: "Failed to create gender option" });
    }
  });

  // PUT /api/gender-options/:id - Update a gender option (requires admin permission)
  app.put("/api/gender-options/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, nota, sequence } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (code !== undefined) {
        if (typeof code !== 'string' || !code.trim()) {
          return res.status(400).json({ message: "Code must be a non-empty string" });
        }
        updates.code = code.trim();
      }
      
      if (nota !== undefined) {
        if (typeof nota !== 'boolean') {
          return res.status(400).json({ message: "Nota must be a boolean" });
        }
        updates.nota = nota;
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      const genderOption = await storage.options.gender.updateGenderOption(id, updates);
      
      if (!genderOption) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.json(genderOption);
    } catch (error: any) {
      if (error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(409).json({ message: "A gender option with this code already exists" });
      }
      res.status(500).json({ message: "Failed to update gender option" });
    }
  });

  // DELETE /api/gender-options/:id - Delete a gender option (requires admin permission)
  app.delete("/api/gender-options/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.gender.deleteGenderOption(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete gender option" });
    }
  });
}

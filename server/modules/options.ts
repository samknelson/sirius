import type { Express } from "express";
import { storage } from "../storage";
import { insertWorkerWsSchema, updateWorkerWsSchema, insertEmploymentStatusSchema, updateEmploymentStatusSchema, insertTrustBenefitTypeSchema, insertTrustProviderTypeSchema, insertEventTypeSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";

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
  app.post("/api/worker-id-types", requireAccess('admin'), async (req, res) => {
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
  app.put("/api/worker-id-types/:id", requireAccess('admin'), async (req, res) => {
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
  app.delete("/api/worker-id-types/:id", requireAccess('admin'), async (req, res) => {
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
  app.get("/api/employer-contact-types", requireAccess('admin'), async (req, res) => {
    try {
      const contactTypes = await storage.options.employerContactTypes.getAll();
      res.json(contactTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact types" });
    }
  });

  // GET /api/employer-contact-types/:id - Get a specific employer contact type (requires admin permission)
  app.get("/api/employer-contact-types/:id", requireAccess('admin'), async (req, res) => {
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
  app.post("/api/employer-contact-types", requireAccess('admin'), async (req, res) => {
    try {
      const { name, description, data } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const contactType = await storage.options.employerContactTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        data: data && typeof data === 'object' ? data : null,
      });
      
      res.status(201).json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer contact type" });
    }
  });

  // PUT /api/employer-contact-types/:id - Update an employer contact type (requires admin permission)
  app.put("/api/employer-contact-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, data } = req.body;
      
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
      
      if (data !== undefined) {
        updates.data = data && typeof data === 'object' ? data : null;
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
  app.delete("/api/employer-contact-types/:id", requireAccess('admin'), async (req, res) => {
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

  // Employer Type routes

  // GET /api/employer-types - Get all employer types (requires admin permission)
  app.get("/api/employer-types", requireAccess('admin'), async (req, res) => {
    try {
      const employerTypes = await storage.options.employerTypes.getAll();
      res.json(employerTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer types" });
    }
  });

  // GET /api/employer-types/:id - Get a specific employer type (requires admin permission)
  app.get("/api/employer-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const employerType = await storage.options.employerTypes.get(id);
      
      if (!employerType) {
        res.status(404).json({ message: "Employer type not found" });
        return;
      }
      
      res.json(employerType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer type" });
    }
  });

  // POST /api/employer-types - Create a new employer type (requires admin permission)
  app.post("/api/employer-types", requireAccess('admin'), async (req, res) => {
    try {
      const { name, description, sequence, data } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const employerType = await storage.options.employerTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        sequence: typeof sequence === 'number' ? sequence : 0,
        data: data && typeof data === 'object' ? data : null,
      });
      
      res.status(201).json(employerType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer type" });
    }
  });

  // PUT /api/employer-types/:id - Update an employer type (requires admin permission)
  app.put("/api/employer-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sequence, data } = req.body;
      
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
      
      if (data !== undefined) {
        updates.data = data && typeof data === 'object' ? data : null;
      }
      
      const employerType = await storage.options.employerTypes.update(id, updates);
      
      if (!employerType) {
        res.status(404).json({ message: "Employer type not found" });
        return;
      }
      
      res.json(employerType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update employer type" });
    }
  });

  // DELETE /api/employer-types/:id - Delete an employer type (requires admin permission)
  app.delete("/api/employer-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.employerTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer type" });
    }
  });

  // Provider Contact Type routes

  // GET /api/provider-contact-types - Get all provider contact types (requires admin permission)
  app.get("/api/provider-contact-types", requireAccess('admin'), async (req, res) => {
    try {
      const contactTypes = await storage.options.trustProviderTypes.getAll();
      res.json(contactTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contact types" });
    }
  });

  // GET /api/provider-contact-types/:id - Get a specific provider contact type (requires admin permission)
  app.get("/api/provider-contact-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const contactType = await storage.options.trustProviderTypes.get(id);
      
      if (!contactType) {
        res.status(404).json({ message: "Provider contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contact type" });
    }
  });

  // POST /api/provider-contact-types - Create a new provider contact type (requires admin permission)
  app.post("/api/provider-contact-types", requireAccess('admin'), async (req, res) => {
    try {
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const contactType = await storage.options.trustProviderTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
      });
      
      res.status(201).json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create provider contact type" });
    }
  });

  // PUT /api/provider-contact-types/:id - Update a provider contact type (requires admin permission)
  app.put("/api/provider-contact-types/:id", requireAccess('admin'), async (req, res) => {
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
      
      const contactType = await storage.options.trustProviderTypes.update(id, updates);
      
      if (!contactType) {
        res.status(404).json({ message: "Provider contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update provider contact type" });
    }
  });

  // DELETE /api/provider-contact-types/:id - Delete a provider contact type (requires admin permission)
  app.delete("/api/provider-contact-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id} = req.params;
      const deleted = await storage.options.trustProviderTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Provider contact type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete provider contact type" });
    }
  });

  // Worker Work Status routes

  // GET /api/worker-work-statuses - Get all worker work statuses (requires admin permission)
  app.get("/api/worker-work-statuses", requireAccess('admin'), async (req, res) => {
    try {
      const statuses = await storage.options.workerWs.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker work statuses" });
    }
  });

  // GET /api/worker-work-statuses/:id - Get a specific worker work status (requires admin permission)
  app.get("/api/worker-work-statuses/:id", requireAccess('admin'), async (req, res) => {
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
  app.post("/api/worker-work-statuses", requireAccess('admin'), async (req, res) => {
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
  app.put("/api/worker-work-statuses/:id", requireAccess('admin'), async (req, res) => {
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
  app.delete("/api/worker-work-statuses/:id", requireAccess('admin'), async (req, res) => {
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
  app.get("/api/employment-statuses", requireAccess('admin'), async (req, res) => {
    try {
      const statuses = await storage.options.employmentStatus.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment statuses" });
    }
  });

  // GET /api/employment-statuses/:id - Get a specific employment status (requires admin permission)
  app.get("/api/employment-statuses/:id", requireAccess('admin'), async (req, res) => {
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
  app.post("/api/employment-statuses", requireAccess('admin'), async (req, res) => {
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
  app.put("/api/employment-statuses/:id", requireAccess('admin'), async (req, res) => {
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
  app.delete("/api/employment-statuses/:id", requireAccess('admin'), async (req, res) => {
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

  // GET /api/ledger-payment-types - Get all ledger payment types (requires ledger.staff policy)
  app.get("/api/ledger-payment-types", requireAccess('ledger.staff'), async (req, res) => {
    try {
      const paymentTypes = await storage.options.ledgerPaymentTypes.getAllLedgerPaymentTypes();
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger payment types" });
    }
  });

  // GET /api/ledger-payment-types/:id - Get a specific ledger payment type (requires ledger.staff policy)
  app.get("/api/ledger-payment-types/:id", requireAccess('ledger.staff'), async (req, res) => {
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

  // POST /api/ledger-payment-types - Create a new ledger payment type (requires ledger.staff policy)
  app.post("/api/ledger-payment-types", requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { name, description, sequence, currencyCode, category } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const validCategory = category === 'financial' || category === 'adjustment' ? category : 'financial';
      
      const paymentType = await storage.options.ledgerPaymentTypes.createLedgerPaymentType({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        sequence: typeof sequence === 'number' ? sequence : 0,
        currencyCode: currencyCode && typeof currencyCode === 'string' ? currencyCode : 'USD',
        category: validCategory,
      });
      
      res.status(201).json(paymentType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create ledger payment type" });
    }
  });

  // PUT /api/ledger-payment-types/:id - Update a ledger payment type (requires ledger.staff policy)
  app.put("/api/ledger-payment-types/:id", requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sequence, currencyCode, category } = req.body;
      
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
      
      if (currencyCode !== undefined) {
        if (typeof currencyCode !== 'string') {
          return res.status(400).json({ message: "Currency code must be a string" });
        }
        updates.currencyCode = currencyCode;
      }
      
      if (category !== undefined) {
        if (category !== 'financial' && category !== 'adjustment') {
          return res.status(400).json({ message: "Category must be 'financial' or 'adjustment'" });
        }
        updates.category = category;
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

  // DELETE /api/ledger-payment-types/:id - Delete a ledger payment type (requires ledger.staff policy)
  app.delete("/api/ledger-payment-types/:id", requireAccess('ledger.staff'), async (req, res) => {
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
  app.post("/api/gender-options", requireAccess('admin'), async (req, res) => {
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
  app.put("/api/gender-options/:id", requireAccess('admin'), async (req, res) => {
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
  app.delete("/api/gender-options/:id", requireAccess('admin'), async (req, res) => {
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

  // Trust Benefit Types routes

  // GET /api/trust-benefit-types - Get all trust benefit types (requires workers.view permission)
  app.get("/api/trust-benefit-types", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const trustBenefitTypes = await storage.options.trustBenefitTypes.getAllTrustBenefitTypes();
      res.json(trustBenefitTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit types" });
    }
  });

  // GET /api/trust-benefit-types/:id - Get a specific trust benefit type (requires workers.view permission)
  app.get("/api/trust-benefit-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const trustBenefitType = await storage.options.trustBenefitTypes.getTrustBenefitType(id);
      
      if (!trustBenefitType) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.json(trustBenefitType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit type" });
    }
  });

  // POST /api/trust-benefit-types - Create a new trust benefit type (requires admin permission)
  app.post("/api/trust-benefit-types", requireAccess('admin'), async (req, res) => {
    try {
      const parsedData = insertTrustBenefitTypeSchema.safeParse(req.body);
      
      if (!parsedData.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: parsedData.error.errors 
        });
        return;
      }
      
      const trustBenefitType = await storage.options.trustBenefitTypes.createTrustBenefitType(parsedData.data);
      res.status(201).json(trustBenefitType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Trust benefit type with this name already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to create trust benefit type" });
    }
  });

  // PUT /api/trust-benefit-types/:id - Update a trust benefit type (requires admin permission)
  app.put("/api/trust-benefit-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const parsedData = insertTrustBenefitTypeSchema.partial().safeParse(req.body);
      
      if (!parsedData.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: parsedData.error.errors 
        });
        return;
      }
      
      const trustBenefitType = await storage.options.trustBenefitTypes.updateTrustBenefitType(id, parsedData.data);
      
      if (!trustBenefitType) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.json(trustBenefitType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Trust benefit type with this name already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to update trust benefit type" });
    }
  });

  // DELETE /api/trust-benefit-types/:id - Delete a trust benefit type (requires admin permission)
  app.delete("/api/trust-benefit-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.trustBenefitTypes.deleteTrustBenefitType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete trust benefit type" });
    }
  });

  // Event Type routes

  // GET /api/event-types - Get all event types (requires admin permission + event component)
  app.get("/api/event-types", requireAccess('admin'), async (req, res) => {
    try {
      const eventTypes = await storage.options.eventTypes.getAll();
      res.json(eventTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event types" });
    }
  });

  // GET /api/event-types/:id - Get a specific event type (requires admin permission)
  app.get("/api/event-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const eventType = await storage.options.eventTypes.get(id);
      
      if (!eventType) {
        res.status(404).json({ message: "Event type not found" });
        return;
      }
      
      res.json(eventType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event type" });
    }
  });

  // POST /api/event-types - Create a new event type (requires admin permission)
  app.post("/api/event-types", requireAccess('admin'), async (req, res) => {
    try {
      const { name, description, data, siriusId, category, config } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (!siriusId || typeof siriusId !== 'string' || !siriusId.trim()) {
        return res.status(400).json({ message: "Sirius ID is required" });
      }
      
      const eventType = await storage.options.eventTypes.create({
        name: name.trim(),
        siriusId: siriusId.trim(),
        description: description && typeof description === 'string' ? description.trim() : undefined,
        data: data && typeof data === 'object' ? data : undefined,
        category: category && typeof category === 'string' ? category.trim() : undefined,
        config: config && typeof config === 'object' ? config : undefined,
      });
      
      res.status(201).json(eventType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Event type with this Sirius ID already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to create event type" });
    }
  });

  // PUT /api/event-types/:id - Update an event type (requires admin permission)
  app.put("/api/event-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, data, siriusId, category, config } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (siriusId !== undefined) {
        if (typeof siriusId !== 'string' || !siriusId.trim()) {
          return res.status(400).json({ message: "Sirius ID must be a non-empty string" });
        }
        updates.siriusId = siriusId.trim();
      }
      
      if (description !== undefined) {
        updates.description = description && typeof description === 'string' ? description.trim() : null;
      }
      
      if (data !== undefined) {
        updates.data = data && typeof data === 'object' ? data : null;
      }
      
      if (category !== undefined) {
        updates.category = category && typeof category === 'string' ? category.trim() : null;
      }
      
      if (config !== undefined) {
        updates.config = config && typeof config === 'object' ? config : null;
      }
      
      const eventType = await storage.options.eventTypes.update(id, updates);
      
      if (!eventType) {
        res.status(404).json({ message: "Event type not found" });
        return;
      }
      
      res.json(eventType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Event type with this Sirius ID already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to update event type" });
    }
  });

  // DELETE /api/event-types/:id - Delete an event type (requires admin permission)
  app.delete("/api/event-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.eventTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Event type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete event type" });
    }
  });

  // Dispatch Job Type routes

  // GET /api/dispatch-job-types - Get all dispatch job types (requires admin permission)
  app.get("/api/dispatch-job-types", requireAccess('admin'), async (req, res) => {
    try {
      const jobTypes = await storage.options.dispatchJobTypes.getAll();
      res.json(jobTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch job types" });
    }
  });

  // GET /api/dispatch-job-types/:id - Get a specific dispatch job type (requires admin permission)
  app.get("/api/dispatch-job-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const jobType = await storage.options.dispatchJobTypes.get(id);
      
      if (!jobType) {
        res.status(404).json({ message: "Dispatch job type not found" });
        return;
      }
      
      res.json(jobType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch job type" });
    }
  });

  // POST /api/dispatch-job-types - Create a new dispatch job type (requires admin permission)
  app.post("/api/dispatch-job-types", requireAccess('admin'), async (req, res) => {
    try {
      const { name, description, data } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const jobType = await storage.options.dispatchJobTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        data: data && typeof data === 'object' ? data : null,
      });
      
      res.status(201).json(jobType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create dispatch job type" });
    }
  });

  // PUT /api/dispatch-job-types/:id - Update a dispatch job type (requires admin permission)
  app.put("/api/dispatch-job-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, data } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (description !== undefined) {
        updates.description = description && typeof description === 'string' ? description.trim() : null;
      }
      
      if (data !== undefined) {
        updates.data = data && typeof data === 'object' ? data : null;
      }
      
      const jobType = await storage.options.dispatchJobTypes.update(id, updates);
      
      if (!jobType) {
        res.status(404).json({ message: "Dispatch job type not found" });
        return;
      }
      
      res.json(jobType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update dispatch job type" });
    }
  });

  // DELETE /api/dispatch-job-types/:id - Delete a dispatch job type (requires admin permission)
  app.delete("/api/dispatch-job-types/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.dispatchJobTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Dispatch job type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete dispatch job type" });
    }
  });
}

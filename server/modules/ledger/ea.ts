import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerEaSchema } from "@shared/schema";
import { policies } from "../../policies";
import { requireAccess } from "../../accessControl";

export function registerLedgerEaRoutes(app: Express) {
  // GET /api/ledger/ea - Get all ledger EA entries
  app.get("/api/ledger/ea", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const entries = await storage.ledger.ea.getAll();
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/entity/:entityType/:entityId - Get ledger EA entries for an entity
  app.get("/api/ledger/ea/entity/:entityType/:entityId", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const entries = await storage.ledger.ea.getByEntity(entityType, entityId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/:id - Get a specific ledger EA entry
  app.get("/api/ledger/ea/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.ledger.ea.get(id);
      
      if (!entry) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entry" });
    }
  });

  // POST /api/ledger/ea - Create a new ledger EA entry
  app.post("/api/ledger/ea", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const validatedData = insertLedgerEaSchema.parse(req.body);
      const entry = await storage.ledger.ea.create(validatedData);
      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid ledger EA data" });
      } else {
        res.status(500).json({ message: "Failed to create ledger EA entry" });
      }
    }
  });

  // PUT /api/ledger/ea/:id - Update a ledger EA entry
  app.put("/api/ledger/ea/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertLedgerEaSchema.partial().parse(req.body);
      
      const entry = await storage.ledger.ea.update(id, validatedData);
      
      if (!entry) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      res.json(entry);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid ledger EA data" });
      } else {
        res.status(500).json({ message: "Failed to update ledger EA entry" });
      }
    }
  });

  // DELETE /api/ledger/ea/:id - Delete a ledger EA entry
  app.delete("/api/ledger/ea/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.ledger.ea.delete(id);
      
      if (!success) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ledger EA entry" });
    }
  });

  // GET /api/ledger/ea/:id/transactions - Get ledger entries for an EA
  app.get("/api/ledger/ea/:id/transactions", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      // Get all transactions for this EA
      const transactions = await storage.ledger.entries.getTransactions({ eaId: id });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger transactions" });
    }
  });
}

import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerAccountSchema } from "@shared/schema";
import { policies } from "../../policies";
import { requireAccess } from "../../accessControl";

export function registerLedgerAccountRoutes(app: Express) {
  // GET /api/ledger/accounts - Get all ledger accounts
  app.get("/api/ledger/accounts", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const accounts = await storage.ledger.accounts.getAll();
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger accounts" });
    }
  });

  // GET /api/ledger/accounts/:id - Get a specific ledger account
  app.get("/api/ledger/accounts/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const account = await storage.ledger.accounts.get(id);
      
      if (!account) {
        res.status(404).json({ message: "Ledger account not found" });
        return;
      }
      
      res.json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger account" });
    }
  });

  // POST /api/ledger/accounts - Create a new ledger account
  app.post("/api/ledger/accounts", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const validatedData = insertLedgerAccountSchema.parse(req.body);
      const account = await storage.ledger.accounts.create(validatedData);
      res.status(201).json(account);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid ledger account data" });
      } else {
        res.status(500).json({ message: "Failed to create ledger account" });
      }
    }
  });

  // PUT /api/ledger/accounts/:id - Update a ledger account
  app.put("/api/ledger/accounts/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertLedgerAccountSchema.partial().parse(req.body);
      
      const account = await storage.ledger.accounts.update(id, validatedData);
      
      if (!account) {
        res.status(404).json({ message: "Ledger account not found" });
        return;
      }
      
      res.json(account);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid ledger account data" });
      } else {
        res.status(500).json({ message: "Failed to update ledger account" });
      }
    }
  });

  // DELETE /api/ledger/accounts/:id - Delete a ledger account
  app.delete("/api/ledger/accounts/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.ledger.accounts.delete(id);
      
      if (!success) {
        res.status(404).json({ message: "Ledger account not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ledger account" });
    }
  });
}

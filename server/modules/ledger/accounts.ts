import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerAccountSchema, ledgerAccountDataSchema } from "@shared/schema";
import { getAllCurrencies, hasCurrency } from "@shared/currency";
import { policies } from "../../policies";
import { requireAccess } from "../../accessControl";
import { requireComponent } from "../components";

export function registerLedgerAccountRoutes(app: Express) {
  // GET /api/ledger/currencies - Get all available currencies
  app.get("/api/ledger/currencies", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const currencies = getAllCurrencies().map(c => ({
        code: c.code,
        label: c.label,
        precision: c.precision,
        symbol: c.symbol,
        symbolPosition: c.symbolPosition,
      }));
      res.json(currencies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch currencies" });
    }
  });
  // GET /api/ledger/accounts - Get all ledger accounts
  app.get("/api/ledger/accounts", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const accounts = await storage.ledger.accounts.getAll();
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger accounts" });
    }
  });

  // GET /api/ledger/accounts/:id - Get a specific ledger account
  app.get("/api/ledger/accounts/:id", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
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
  app.post("/api/ledger/accounts", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const validatedData = insertLedgerAccountSchema.parse(req.body);
      
      // Validate currency code exists in registry
      const currencyCode = validatedData.currencyCode || "USD";
      if (!hasCurrency(currencyCode)) {
        res.status(400).json({ message: `Invalid currency code: ${currencyCode}` });
        return;
      }
      
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
  app.put("/api/ledger/accounts/:id", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertLedgerAccountSchema.partial().parse(req.body);
      
      // Prevent currencyCode from being updated - it's immutable after creation
      const { currencyCode, ...safeUpdateData } = validatedData;
      
      const account = await storage.ledger.accounts.update(id, safeUpdateData);
      
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

  // PATCH /api/ledger/accounts/:id - Update account data field only
  app.patch("/api/ledger/accounts/:id", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const { data } = req.body;
      
      // Validate the data structure - explicitly handle undefined and null
      let validatedData;
      if (data === undefined || data === null) {
        validatedData = null;
      } else {
        validatedData = ledgerAccountDataSchema.parse(data);
      }
      
      const account = await storage.ledger.accounts.update(id, { data: validatedData });
      
      if (!account) {
        res.status(404).json({ message: "Ledger account not found" });
        return;
      }
      
      res.json(account);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid account data format" });
      } else {
        res.status(500).json({ message: "Failed to update ledger account settings" });
      }
    }
  });

  // DELETE /api/ledger/accounts/:id - Delete a ledger account
  app.delete("/api/ledger/accounts/:id", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
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

  // GET /api/ledger/accounts/:id/participants - Get account participants with pagination
  app.get("/api/ledger/accounts/:id/participants", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await storage.ledger.accounts.getParticipants(id, limit, offset);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch account participants" });
    }
  });

  // GET /api/ledger/accounts/:id/transactions - Get ledger entries for an account
  app.get("/api/ledger/accounts/:id/transactions", requireComponent("ledger"), requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if account exists
      const account = await storage.ledger.accounts.get(id);
      if (!account) {
        res.status(404).json({ message: "Ledger account not found" });
        return;
      }

      // Get all transactions for this account
      const transactions = await storage.ledger.entries.getByAccountId(id);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger transactions" });
    }
  });
}

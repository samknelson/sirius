import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerEaSchema } from "@shared/schema";
import { requireAccess } from "../../accessControl";
import { requireComponent } from "../components";
import { generateInvoicePdf } from "../../utils/pdfGenerator";

export function registerLedgerEaRoutes(app: Express) {
  // GET /api/ledger/ea - Get all ledger EA entries
  app.get("/api/ledger/ea", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const entries = await storage.ledger.ea.getAll();
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/entity/:entityType/:entityId - Get ledger EA entries for an entity
  app.get("/api/ledger/ea/entity/:entityType/:entityId", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const entries = await storage.ledger.ea.getByEntity(entityType, entityId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/:id - Get a specific ledger EA entry
  app.get("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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
  app.post("/api/ledger/ea", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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
  app.put("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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
  app.delete("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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

  // GET /api/ledger/ea/:id/balance - Get the current balance for an EA
  app.get("/api/ledger/ea/:id/balance", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      const balance = await storage.ledger.ea.getBalance(id);
      res.json({ balance });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch EA balance" });
    }
  });

  // GET /api/ledger/ea/:id/transactions - Get ledger entries for an EA
  app.get("/api/ledger/ea/:id/transactions", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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

  // GET /api/ledger/ea/:id/invoices - Get invoice list for an EA
  app.get("/api/ledger/ea/:id/invoices", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      // Get invoice summaries
      const invoices = await storage.ledger.invoices.listForEa(id);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // GET /api/ledger/ea/:id/invoices/:month/:year - Get invoice details
  app.get("/api/ledger/ea/:id/invoices/:month/:year", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id, month, year } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      // Get invoice details
      const invoice = await storage.ledger.invoices.getDetails(
        id,
        parseInt(month, 10),
        parseInt(year, 10)
      );

      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      res.json(invoice);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invoice details" });
    }
  });

  // GET /api/ledger/ea/:id/invoices/:month/:year/pdf - Download invoice as PDF
  app.get("/api/ledger/ea/:id/invoices/:month/:year/pdf", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id, month, year } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      // Get account info
      const account = await storage.ledger.accounts.get(ea.accountId);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }

      // Get entity name
      let entityName = "Unknown Entity";
      if (ea.entityType === "employer") {
        const employer = await storage.employers.getEmployer(ea.entityId);
        entityName = employer ? employer.name : "Unknown Employer";
      } else if (ea.entityType === "worker") {
        const worker = await storage.workers.getWorker(ea.entityId);
        if (worker) {
          const contact = await storage.contacts.getContact(worker.contactId);
          entityName = contact ? `${contact.given} ${contact.family}` : "Unknown Worker";
        } else {
          entityName = "Unknown Worker";
        }
      } else if (ea.entityType === "trust_provider") {
        const provider = await storage.trustProviders.getTrustProvider(ea.entityId);
        entityName = provider ? provider.name : "Unknown Trust Provider";
      }

      // Get invoice details
      const invoice = await storage.ledger.invoices.getDetails(
        id,
        parseInt(month, 10),
        parseInt(year, 10)
      );

      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      // Generate PDF
      const pdfBuffer = await generateInvoicePdf({
        eaName: entityName,
        accountName: account.name,
        month: invoice.month,
        year: invoice.year,
        incomingBalance: invoice.incomingBalance,
        invoiceBalance: invoice.invoiceBalance,
        outgoingBalance: invoice.outgoingBalance,
        entries: invoice.entries,
        invoiceHeader: invoice.invoiceHeader,
        invoiceFooter: invoice.invoiceFooter,
      });

      // Set headers for PDF download
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const monthName = monthNames[invoice.month - 1];
      const filename = `invoice-${monthName}-${invoice.year}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });
}

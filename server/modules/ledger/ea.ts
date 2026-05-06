import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { insertLedgerEaSchema } from "@shared/schema";
import { requireAccess, checkAccessInline } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { generateInvoicePdf } from "../../utils/pdfGenerator";

async function checkEaAccessInline(req: Request, res: Response, ea: { entityType: string; entityId: string }, policyId: string): Promise<boolean> {
  const result = await checkAccessInline(req, policyId, ea.entityId, { entityType: ea.entityType, entityId: ea.entityId });
  if (!result.granted) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}

export function registerLedgerEaRoutes(app: Express) {
  // GET /api/ledger/ea - Get all ledger EA entries (staff only), optionally filtered by accountId
  app.get("/api/ledger/ea", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const accountIdFilter = req.query.accountId as string | undefined;
      let entries = await storage.ledger.ea.getAll();
      if (accountIdFilter) {
        entries = entries.filter(e => e.accountId === accountIdFilter);
      }

      const employerIds = entries.filter(e => e.entityType === "employer").map(e => e.entityId);
      const workerIds = entries.filter(e => e.entityType === "worker").map(e => e.entityId);
      const tpIds = entries.filter(e => e.entityType === "trustProvider" || e.entityType === "trust_provider").map(e => e.entityId);

      const nameMap = new Map<string, string>();

      if (employerIds.length > 0) {
        for (const eid of employerIds) {
          const emp = await storage.employers.getEmployer(eid);
          if (emp) nameMap.set(eid, emp.name);
        }
      }
      if (workerIds.length > 0) {
        for (const wid of workerIds) {
          const worker = await storage.workers.getWorker(wid);
          if (worker) {
            const contact = await storage.contacts.getContact(worker.contactId);
            if (contact) {
              nameMap.set(wid, `${contact.given || ""} ${contact.family || ""}`.trim());
            }
          }
        }
      }
      if (tpIds.length > 0) {
        for (const tid of tpIds) {
          const tp = await storage.trustProviders.getTrustProvider(tid);
          if (tp) nameMap.set(tid, tp.name);
        }
      }

      const enriched = entries.map(e => ({
        ...e,
        entityName: nameMap.get(e.entityId) || null,
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Failed to fetch ledger EA entries:", error);
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/entity/:entityType/:entityId - Get ledger EA entries for an entity (with balances)
  app.get("/api/ledger/ea/entity/:entityType/:entityId", requireComponent("ledger"), requireAccess('ledger.ea.view', {
    getEntityId: (req) => req.params.entityId,
    getEntityData: (req) => ({ entityType: req.params.entityType, entityId: req.params.entityId })
  }), async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const entries = await storage.ledger.ea.getByEntityWithBalance(entityType, entityId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entries" });
    }
  });

  // GET /api/ledger/ea/:id - Get a specific ledger EA entry
  app.get("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.ledger.ea.get(id);
      
      if (!entry) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      if (!await checkEaAccessInline(req, res, entry, 'ledger.ea.view')) return;
      
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger EA entry" });
    }
  });

  // POST /api/ledger/ea - Create a new ledger EA entry
  app.post("/api/ledger/ea", requireComponent("ledger"), requireAccess('ledger.ea.edit', {
    getEntityId: (req) => req.body.entityId,
    getEntityData: (req) => ({ entityType: req.body.entityType, entityId: req.body.entityId })
  }), async (req, res) => {
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
  app.put("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Fetch existing EA to check access
      const existing = await storage.ledger.ea.get(id);
      if (!existing) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      if (!await checkEaAccessInline(req, res, existing, 'ledger.ea.edit')) return;
      
      const validatedData = insertLedgerEaSchema.partial().parse(req.body);
      const entry = await storage.ledger.ea.update(id, validatedData);
      
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
  app.delete("/api/ledger/ea/:id", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Fetch existing EA to check access
      const existing = await storage.ledger.ea.get(id);
      if (!existing) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }
      
      if (!await checkEaAccessInline(req, res, existing, 'ledger.ea.edit')) return;
      
      const success = await storage.ledger.ea.delete(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ledger EA entry" });
    }
  });

  // GET /api/ledger/ea/:id/balance - Get the current balance for an EA
  app.get("/api/ledger/ea/:id/balance", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

      const balance = await storage.ledger.ea.getBalance(id);
      res.json({ balance });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch EA balance" });
    }
  });

  // GET /api/ledger/ea/:id/transactions - Get ledger entries for an EA (paginated)
  app.get("/api/ledger/ea/:id/transactions", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      const maxLimit = req.query.export === 'true' ? 100000 : 200;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, maxLimit);
      const offset = parseInt(req.query.offset as string) || 0;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

      // Get paginated transactions for this EA
      const result = await storage.ledger.entries.getTransactionsPaginated({ eaId: id }, limit, offset);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger transactions" });
    }
  });

  // GET /api/ledger/ea/:id/invoices - Get invoice list for an EA
  app.get("/api/ledger/ea/:id/invoices", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

      // Get invoice summaries
      const invoices = await storage.ledger.invoices.listForEa(id);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // GET /api/ledger/ea/:id/invoices/:month/:year - Get invoice details
  app.get("/api/ledger/ea/:id/invoices/:month/:year", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id, month, year } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

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
  app.get("/api/ledger/ea/:id/invoices/:month/:year/pdf", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id, month, year } = req.params;
      
      // Check if EA exists
      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

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

  app.get("/api/ledger/ea/:id/account-summary", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      const rawMonths = parseInt(req.query.months as string, 10);
      const monthsParam = Math.min(Math.max(isNaN(rawMonths) ? 6 : rawMonths, 1), 36);
      const groupBy = req.query.groupBy === "statementYmd" ? "statementYmd" : "date";

      const ea = await storage.ledger.ea.get(id);
      if (!ea) {
        res.status(404).json({ message: "Ledger EA entry not found" });
        return;
      }

      if (!await checkEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

      const account = await storage.ledger.accounts.get(ea.accountId);
      const currencyCode = account?.currencyCode || "USD";

      const allEntries = await storage.ledger.entries.getByEaId(id);
      const entries = allEntries
        .slice()
        .sort((a, b) => {
          const ad = a.date ? new Date(a.date).getTime() : 0;
          const bd = b.date ? new Date(b.date).getTime() : 0;
          return ad - bd;
        })
        .map(e => ({
          id: e.id,
          amount: e.amount,
          date: e.date,
          statementYmd: e.statementYmd,
          chargePlugin: e.chargePlugin,
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          memo: e.memo,
          data: e.data,
        }));

      const paymentRefIds = [...new Set(
        entries
          .filter(e => e.chargePlugin === "payment-simple-allocation" && e.referenceId)
          .map(e => e.referenceId!)
      )];

      const paymentMap = new Map<string, { id: string; paymentType: string; dateReceived: Date | null; details: unknown; }>();
      if (paymentRefIds.length > 0) {
        const paymentRows = await storage.ledger.payments.getByIds(paymentRefIds);
        for (const p of paymentRows) {
          paymentMap.set(p.id, {
            id: p.id,
            paymentType: p.paymentType,
            dateReceived: p.dateReceived,
            details: p.details,
          });
        }
      }

      const paymentTypeIds = [...new Set([...paymentMap.values()].map(p => p.paymentType))];
      let paymentTypeMap = new Map<string, { name: string; category: string }>();
      if (paymentTypeIds.length > 0) {
        const ptRows = await storage.ledger.paymentTypes.getByIds(paymentTypeIds);
        for (const pt of ptRows) {
          paymentTypeMap.set(pt.id, { name: pt.name, category: pt.category });
        }
      }

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const currentPeriod = { month: currentMonth, year: currentYear };

      const periods: { month: number; year: number }[] = [];
      let m = currentMonth - 1;
      let y = currentYear;
      if (m < 1) { m = 12; y--; }
      for (let i = 0; i < monthsParam; i++) {
        periods.unshift({ month: m, year: y });
        m--;
        if (m < 1) { m = 12; y--; }
      }

      const toCents = (amount: string): bigint => {
        const parts = amount.split(".");
        const whole = BigInt(parts[0] || "0");
        let frac = (parts[1] || "00").padEnd(2, "0").slice(0, 2);
        const sign = whole < BigInt(0) || amount.startsWith("-") ? BigInt(-1) : BigInt(1);
        return sign * (BigInt(sign < 0 ? -whole : whole) * BigInt(100) + BigInt(frac));
      };
      const fromCents = (cents: bigint): string => {
        const neg = cents < BigInt(0);
        const abs = neg ? -cents : cents;
        const whole = abs / BigInt(100);
        const frac = abs % BigInt(100);
        return `${neg ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
      };

      interface MonthData {
        charges: bigint;
        chargeEntryCount: number;
        chargeWorkerIds: Set<string>;
        chargeHours: number;
        adjustments: bigint;
        adjustmentEntryCount: number;
        interestPenalties: bigint;
        interestPenaltyEntryCount: number;
        paymentsCredited: bigint;
        paymentDetails: string[];
        allEntriesSum: bigint;
      }

      const monthDataMap = new Map<string, MonthData>();
      const getKey = (month: number, year: number) => `${year}-${month}`;

      const initMonthData = (): MonthData => ({
        charges: BigInt(0),
        chargeEntryCount: 0,
        chargeWorkerIds: new Set(),
        chargeHours: 0,
        adjustments: BigInt(0),
        adjustmentEntryCount: 0,
        interestPenalties: BigInt(0),
        interestPenaltyEntryCount: 0,
        paymentsCredited: BigInt(0),
        paymentDetails: [],
        allEntriesSum: BigInt(0),
      });

      for (const period of periods) {
        monthDataMap.set(getKey(period.month, period.year), initMonthData());
      }
      const currentKey = getKey(currentPeriod.month, currentPeriod.year);
      monthDataMap.set(currentKey, initMonthData());

      let preIncomingCents = BigInt(0);
      const firstPeriod = periods[0];
      const getVisibleMonth = (month: number, year: number): MonthData | null => {
        const key = getKey(month, year);
        const data = monthDataMap.get(key);
        if (data) return data;
        if (firstPeriod && (year < firstPeriod.year || (year === firstPeriod.year && month < firstPeriod.month))) {
          return null;
        }
        return monthDataMap.get(currentKey) || null;
      };

      const parseBucketFromStmtYmd = (ymd: string, fallbackMonth: number, fallbackYear: number) => {
        const [sy, sm] = ymd.split("-").map(Number);
        return (sy && sm) ? { month: sm, year: sy } : { month: fallbackMonth, year: fallbackYear };
      };

      for (const entry of entries) {
        if (!entry.date) continue;
        const d = new Date(entry.date);
        const em = d.getMonth() + 1;
        const ey = d.getFullYear();
        const amountCents = toCents(entry.amount);

        let bucketMonth: number;
        let bucketYear: number;

        if (groupBy === "statementYmd" && entry.statementYmd) {
          const parsed = parseBucketFromStmtYmd(entry.statementYmd, em, ey);
          bucketMonth = parsed.month;
          bucketYear = parsed.year;
        } else {
          bucketMonth = em;
          bucketYear = ey;
        }

        const bucketKey = getKey(bucketMonth, bucketYear);
        const bucketData = monthDataMap.get(bucketKey);
        if (bucketData) {
          bucketData.allEntriesSum += amountCents;
        } else if (firstPeriod && (bucketYear < firstPeriod.year || (bucketYear === firstPeriod.year && bucketMonth < firstPeriod.month))) {
          preIncomingCents += amountCents;
        }

        if (entry.chargePlugin === "payment-simple-allocation") {
          const payment = entry.referenceId ? paymentMap.get(entry.referenceId) : undefined;
          const pt = payment ? paymentTypeMap.get(payment.paymentType) : undefined;
          const category = pt?.category || "financial";

          const catData = getVisibleMonth(bucketMonth, bucketYear);

          if (catData) {
            if (category === "adjustment") {
              catData.adjustments += amountCents;
              catData.adjustmentEntryCount++;
            } else {
              catData.paymentsCredited += amountCents;

              if (payment) {
                const details = (payment.details || {}) as Record<string, unknown>;
                const checkNum = (details.checkTransactionNumber as string) || null;
                const dateReceived = payment.dateReceived
                  ? new Date(payment.dateReceived).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })
                  : null;
                let detailStr = "";
                if (checkNum) {
                  detailStr = `CK # ${checkNum}`;
                  if (dateReceived) detailStr += ` Rec'd ${dateReceived}`;
                } else if (dateReceived) {
                  detailStr = `Rec'd ${dateReceived}`;
                }
                if (detailStr) catData.paymentDetails.push(detailStr);
              }
            }
          }
        } else if (entry.chargePlugin === "interest" || entry.chargePlugin === "penalty") {
          const catData = getVisibleMonth(bucketMonth, bucketYear);
          if (catData) {
            catData.interestPenalties += amountCents;
            catData.interestPenaltyEntryCount++;
          }
        } else {
          const positiveAmount = amountCents > BigInt(0) ? amountCents : BigInt(0);
          const catData = getVisibleMonth(bucketMonth, bucketYear);
          if (catData && positiveAmount > BigInt(0)) {
            catData.charges += positiveAmount;
            catData.chargeEntryCount++;
            if (entry.referenceId) {
              catData.chargeWorkerIds.add(entry.referenceId);
            }
            const meta = entry.data as Record<string, unknown> | null;
            if (meta && typeof meta.hours === "number") {
              catData.chargeHours += meta.hours;
            }
          }
        }
      }

      let runningBalanceCents = preIncomingCents;

      const buildColumn = (data: MonthData, period: { month: number; year: number }) => {
        const incomingBalance = fromCents(runningBalanceCents);
        runningBalanceCents += data.allEntriesSum;
        const statementBalance = fromCents(runningBalanceCents);

        const chargesAmount = fromCents(data.charges);
        const adjustmentsAmount = fromCents(data.adjustments);
        const interestPenaltiesAmount = fromCents(data.interestPenalties);
        const paymentsCreditedAmount = fromCents(data.paymentsCredited);

        const unpaidCents = data.charges + data.adjustments + data.interestPenalties + data.paymentsCredited;
        const unpaidStatementAmount = fromCents(unpaidCents);

        const detailParts: string[] = [];
        if (data.chargeWorkerIds.size > 0) {
          detailParts.push(`${data.chargeWorkerIds.size} worker${data.chargeWorkerIds.size !== 1 ? "s" : ""}`);
        }
        if (data.chargeHours > 0) {
          detailParts.push(`${data.chargeHours} hrs`);
        }
        if (detailParts.length === 0 && data.chargeEntryCount > 0) {
          detailParts.push(`${data.chargeEntryCount} entr${data.chargeEntryCount !== 1 ? "ies" : "y"}`);
        }
        const chargeDetail = detailParts.join(", ");

        let adjustmentDetail = "";
        if (data.adjustmentEntryCount > 0) {
          adjustmentDetail = `${data.adjustmentEntryCount} adjustment${data.adjustmentEntryCount !== 1 ? "s" : ""}`;
        }

        let interestPenaltyDetail = "";
        if (data.interestPenaltyEntryCount > 0) {
          interestPenaltyDetail = `${data.interestPenaltyEntryCount} entr${data.interestPenaltyEntryCount !== 1 ? "ies" : "y"}`;
        }

        const paymentDetail = [...new Set(data.paymentDetails)].join(", ");

        return {
          month: period.month,
          year: period.year,
          charges: chargesAmount,
          chargeDetail,
          adjustments: adjustmentsAmount,
          adjustmentDetail,
          interestPenalties: interestPenaltiesAmount,
          interestPenaltyDetail,
          paymentsCredited: paymentsCreditedAmount,
          paymentDetail,
          unpaidStatementAmount,
          statementBalance,
          incomingBalance,
        };
      };

      const monthColumns = periods.map(period => {
        const data = monthDataMap.get(getKey(period.month, period.year))!;
        return buildColumn(data, period);
      });

      const currentData = monthDataMap.get(currentKey)!;
      const currentColumn = buildColumn(currentData, currentPeriod);

      const overallIncomingBalance = monthColumns.length > 0 ? monthColumns[0].incomingBalance : "0.00";

      res.json({
        currencyCode,
        groupBy,
        incomingBalance: overallIncomingBalance,
        currentBalance: currentColumn.statementBalance,
        months: monthColumns,
        current: currentColumn,
      });
    } catch (error) {
      console.error("Failed to fetch account summary:", error);
      res.status(500).json({ message: "Failed to fetch account summary" });
    }
  });
}

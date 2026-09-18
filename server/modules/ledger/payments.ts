import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { insertFileSchema, insertLedgerPaymentSchema, type LedgerPayment, type LedgerPaymentWithEntity, type AllocatedEntity } from "@shared/schema";
import { requireAccess, checkAccessInline } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { executeChargePlugins, TriggerType, PaymentSavedContext, LedgerNotification } from "../../plugins/ledger/charge";
import { logger } from "../../logger";
import { eventBus, EventType } from "../../services/event-bus";
import { isValidYmd, ymdToDateForPicker, dateToYmd } from "@shared/utils/date";
import { isComponentEnabled } from "../components";
import { respondWithTransactions } from "./transaction-query";
import { onAfterCommit, runInTransaction, runOutsideTransaction } from "../../storage/transaction-context";
import { storageLogger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { fileSystemService, isFileSystemConfigured } from "../../services/files";
import multer from "multer";
import { extname } from "path";

const paymentAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const PAYMENT_ATTACHMENT_MIMES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
};

export function validatePaymentAttachment(file: { originalname: string; mimetype: string }): string | null {
  const extension = extname(file.originalname).toLowerCase();
  const expectedExtension = PAYMENT_ATTACHMENT_MIMES[file.mimetype];
  if (
    !expectedExtension ||
    (file.mimetype === "image/jpeg" && extension !== ".jpg" && extension !== ".jpeg") ||
    (file.mimetype !== "image/jpeg" && extension !== expectedExtension)
  ) {
    return "Unsupported attachment. Upload a JPEG, PNG, GIF, WebP, BMP, or TIFF image.";
  }
  return null;
}

export function ordinaryPaymentAttachmentError(body: unknown): string | null {
  return Object.prototype.hasOwnProperty.call(body ?? {}, "attachmentFileId")
    ? "Payment attachments must be uploaded through the attachment endpoint"
    : null;
}

const paymentAttachmentUploadMiddleware = (req: Request, res: Response, next: () => void) =>
  paymentAttachmentUpload.single("file")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ message: "Image attachment is too large (maximum 20 MB)." });
      return;
    }
    res.status(400).json({ message: "Invalid image upload." });
  });

async function removePaymentAttachmentObject(file: { id: string; fileSystemId: string; storagePath: string }) {
  try {
    await fileSystemService.remove(file.fileSystemId, file.storagePath);
  } catch (error) {
    logger.warn("Payment attachment object cleanup failed", {
      paymentAttachmentFileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function schedulePaymentAttachmentCleanup(file: { id: string; fileSystemId: string; storagePath: string }) {
  onAfterCommit(() => {
    void runOutsideTransaction(() => removePaymentAttachmentObject(file));
  });
}

const unifiedOptionsStorage = createUnifiedOptionsStorage();

export async function enrichWithAllocatedEntities<T extends LedgerPayment>(
  payments: T[],
): Promise<Array<T & { allocatedEntities: AllocatedEntity[] }>> {
  const allEaIds = new Set<string>();
  for (const payment of payments) {
    const details = payment.details as Record<string, unknown> | null;
    const pa = Array.isArray(details?.proposedAllocation)
      ? (details.proposedAllocation as Array<{ eaId: string }>)
      : [];
    for (const alloc of pa) {
      if (alloc.eaId) allEaIds.add(alloc.eaId);
    }
  }

  if (allEaIds.size === 0) {
    return payments.map(p => ({ ...p, allocatedEntities: [] }));
  }

  const eaMap = new Map<string, { entityType: string; entityId: string }>();
  const entityEmployerIds = new Set<string>();

  for (const eaId of allEaIds) {
    const ea = await storage.ledger.ea.get(eaId);
    if (ea) {
      eaMap.set(eaId, { entityType: ea.entityType, entityId: ea.entityId });
      if (ea.entityType === "employer") {
        entityEmployerIds.add(ea.entityId);
      }
    }
  }

  const employerNames = new Map<string, string>();
  for (const empId of entityEmployerIds) {
    const emp = await storage.employers.getEmployer(empId);
    if (emp) employerNames.set(empId, emp.name);
  }

  return payments.map(payment => {
    const details = payment.details as Record<string, unknown> | null;
    const pa = Array.isArray(details?.proposedAllocation)
      ? (details.proposedAllocation as Array<{ eaId: string }>)
      : [];

    const seenEaIds = new Set<string>();
    const allocatedEntities: AllocatedEntity[] = [];
    for (const alloc of pa) {
      if (!alloc.eaId || seenEaIds.has(alloc.eaId)) continue;
      seenEaIds.add(alloc.eaId);
      const ea = eaMap.get(alloc.eaId);
      if (ea) {
        allocatedEntities.push({
          eaId: alloc.eaId,
          entityType: ea.entityType,
          entityId: ea.entityId,
          entityName: ea.entityType === "employer"
            ? employerNames.get(ea.entityId) || null
            : null,
        });
      }
    }

    return { ...payment, allocatedEntities };
  });
}

export interface PaymentAllocationAuditSummary {
  paymentId: string;
  status: string;
  dateCleared: Date | null;
  allocationCount: number;
  allocationTotal: string;
  allocationEaIds: string[];
  allocationEntityIds: string[];
}

export async function getPaymentAllocationAuditSummary(
  payment: LedgerPayment,
): Promise<PaymentAllocationAuditSummary> {
  const details = payment.details as Record<string, unknown> | null;
  const proposed = Array.isArray(details?.proposedAllocation)
    ? details.proposedAllocation as ProposedAllocationEntry[]
    : [];
  const allocations = proposed.length > 0
    ? proposed
    : [{ eaId: payment.ledgerEaId, amount: payment.amount, statementYmd: "" }];
  const allocationEaIds = [...new Set(allocations.map((allocation) => allocation.eaId))];
  const allocationEntityIds: string[] = [];
  for (const eaId of allocationEaIds) {
    const ea = await storage.ledger.ea.get(eaId);
    if (ea) allocationEntityIds.push(ea.entityId);
  }
  const totalCents = allocations.reduce(
    (sum, allocation) => sum + (parseExactMoneyToCents(allocation.amount) ?? 0),
    0,
  );
  return {
    paymentId: payment.id,
    status: payment.status,
    dateCleared: payment.dateCleared,
    allocationCount: allocations.length,
    allocationTotal: (totalCents / 100).toFixed(2),
    allocationEaIds,
    allocationEntityIds: [...new Set(allocationEntityIds)],
  };
}

export function logBatchPaymentActivity(
  batchId: string,
  operation: "createPayment" | "assignPayment" | "updatePayment" | "postPayment" | "removePayment" | "deletePayment",
  summary: PaymentAllocationAuditSummary,
): void {
  const context = getRequestContext();
  storageLogger.info(`Storage operation: ledger.paymentBatches.${operation}`, {
    module: "ledger.paymentBatches",
    operation,
    entity_id: summary.paymentId,
    host_entity_id: batchId,
    description: `${operation} ${summary.paymentId} (${summary.status}; ${summary.allocationCount} allocations totaling $${summary.allocationTotal})`,
    user_id: context?.userId,
    user_email: context?.userEmail,
    ip_address: context?.ipAddress,
    meta: summary,
  });
}

interface ProposedAllocationEntry {
  eaId: string;
  amount: string;
  statementYmd: string;
}

function parseExactMoneyToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function validateProposedAllocation(
  details: Record<string, unknown> | null | undefined,
  paymentAmount: string
): { valid: boolean; error?: string; allocations?: ProposedAllocationEntry[] } {
  if (!details || !details.proposedAllocation) {
    return { valid: true };
  }
  const raw = details.proposedAllocation;
  if (!Array.isArray(raw)) {
    return { valid: false, error: "proposedAllocation must be an array" };
  }
  const allocations: ProposedAllocationEntry[] = [];
  const seenKeys = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "Each allocation must be an object" };
    }
    if (typeof item.eaId !== "string" || !item.eaId) {
      return { valid: false, error: "Each allocation must have a valid eaId" };
    }
    const amountCents = parseExactMoneyToCents(item.amount);
    if (amountCents === null || amountCents <= 0) {
      return { valid: false, error: "Each allocation must have a valid amount" };
    }
    const ymd = typeof item.statementYmd === "string" ? item.statementYmd : "";
    if (ymd && !isValidYmd(ymd)) {
      return { valid: false, error: "statementYmd must be in YYYY-MM-DD format" };
    }
    if (ymd) {
      const parsed = ymdToDateForPicker(ymd);
      if (dateToYmd(parsed) !== ymd) {
        return { valid: false, error: `Invalid calendar date: ${ymd}` };
      }
    }
    const compositeKey = `${item.eaId}:${ymd}`;
    if (seenKeys.has(compositeKey)) {
      return { valid: false, error: "Duplicate EA + statement date combination" };
    }
    seenKeys.add(compositeKey);
    allocations.push({
      eaId: item.eaId,
      amount: item.amount,
      statementYmd: ymd,
    });
  }
  const paymentCents = parseExactMoneyToCents(paymentAmount);
  if (paymentCents === null) {
    return { valid: false, error: "Payment amount must be an exact monetary value" };
  }
  const allocationTotalCents = allocations.reduce(
    (sum, a) => sum + parseExactMoneyToCents(a.amount)!,
    0,
  );
  if (paymentCents !== allocationTotalCents) {
    return { valid: false, error: "Allocation amounts must equal the payment amount" };
  }
  return { valid: true, allocations };
}

export interface BaoUploadSourceDetails {
  wizardIds: string[];
}

/**
 * Parse and validate the `details.baoUploadSource` allocation method: the
 * payment's amount must exactly equal the combined stored withholding of the
 * selected uploads, every upload must be eligible (completed, same employer,
 * unconsumed — or consumed by THIS payment when editing), and every worker EA
 * must sit on the payment's ledger account. Returns `{ valid: true }` with
 * no `source` when the details carry no upload-source marker.
 */
export async function validateBaoUploadSource(
  details: Record<string, unknown> | null | undefined,
  paymentAmount: string,
  primaryEa: { id: string; accountId: string; entityType: string; entityId: string },
  existingPaymentId?: string,
): Promise<{ valid: boolean; error?: string; source?: BaoUploadSourceDetails }> {
  const raw = details?.baoUploadSource;
  if (!raw) return { valid: true };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "baoUploadSource must be an object" };
  }
  const wizardIds = (raw as Record<string, unknown>).wizardIds;
  if (!Array.isArray(wizardIds) || wizardIds.length === 0 || wizardIds.some((w) => typeof w !== "string" || !w)) {
    return { valid: false, error: "baoUploadSource.wizardIds must be a non-empty array of upload ids" };
  }
  if (new Set(wizardIds).size !== wizardIds.length) {
    return { valid: false, error: "Duplicate uploads selected as allocation source" };
  }
  if (!(await isComponentEnabled("sitespecific.bao"))) {
    return { valid: false, error: "Upload-source allocation requires the BAO component" };
  }
  if (details?.proposedAllocation) {
    return { valid: false, error: "A payment cannot combine upload-source and participant allocations" };
  }
  if (primaryEa.entityType !== "employer") {
    return { valid: false, error: "Upload-source allocation is only available on employer accounts" };
  }

  // Fail explicitly unless the SAME canonical config resolution used at
  // execution time yields a config for this account — otherwise the payment
  // would clear without ever crediting the workers (employer-scoped configs
  // never execute on payment dispatches, so only a global-scope config
  // qualifies; duplicates resolve deterministically to one).
  const { resolveBaoUploadSourceConfig } = await import(
    "../../plugins/ledger/charge/plugins/sitespecific-bao-er-report-to-ee-allocation"
  );
  const canonicalConfig = await resolveBaoUploadSourceConfig(primaryEa.accountId);
  if (!canonicalConfig) {
    return {
      valid: false,
      error:
        'No enabled global-scope "BAO ER report to EE Allocation" charge plugin config exists for this account',
    };
  }

  const eligible = await storage.baoWithholdingAllocations.listEligibleUploads({
    employerId: primaryEa.entityId,
    accountId: primaryEa.accountId,
    includePaymentId: existingPaymentId,
  });
  const eligibleById = new Map(eligible.map((u) => [u.wizardId, u]));
  let totalCents = 0;
  for (const wizardId of wizardIds as string[]) {
    const upload = eligibleById.get(wizardId);
    if (!upload) {
      return {
        valid: false,
        error: "A selected upload is not eligible (it may be incomplete, already consumed by another payment, for a different employer, or on a different account)",
      };
    }
    totalCents += Math.round(parseFloat(upload.totalAmount) * 100);
  }
  const paymentCents = Math.round(parseFloat(paymentAmount) * 100);
  if (paymentCents !== totalCents) {
    return {
      valid: false,
      error: `Payment amount must exactly equal the selected uploads' total withholding of $${(totalCents / 100).toFixed(2)}`,
    };
  }
  return { valid: true, source: { wizardIds: wizardIds as string[] } };
}

/**
 * Reverse the per-worker ledger entries created by the BAO upload-source
 * charge plugin and release the consumed uploads for a payment that is about
 * to be DELETED. The plugin cannot reconcile once the referenced payment row
 * is gone, and the allocation FK only clears `consumed_by_payment_id` — it
 * never touches ledger entries. No-op for payments without the marker.
 */
export async function cleanupUploadSourcePaymentArtifacts(
  paymentId: string,
  details: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!details?.baoUploadSource) return;
  const entries = await storage.ledger.entries.getByReference("payment", paymentId);
  for (const entry of entries) {
    if (entry.chargePlugin === "bao-er-report-to-ee-allocation") {
      await storage.ledger.entries.delete(entry.id);
    }
  }
  await storage.baoWithholdingAllocations.release(paymentId);
}

export type CreatePaymentResult =
  | { ok: true; payment: LedgerPayment }
  | { ok: false; status: number; message: string };

class PaymentStateValidationError extends Error {}

/**
 * Shared payment-creation flow used by both `POST /api/ledger/payments` and
 * `POST /api/ledger-payment-batches/:id/payments`. Performs date coercion,
 * schema parsing (via `insertLedgerPaymentSchema.parse` — `ZodError` is
 * intentionally allowed to propagate so callers retain their existing 400
 * mapping), allocation validation, EA existence checks, and finally
 * `storage.ledger.payments.create`.
 *
 * If `requireAccountId` is set, both the primary EA and every allocation EA
 * must belong to that account; mismatch yields a 400 with a context-specific
 * message.
 */
export async function createPaymentFromRequestBody(
  rawBody: unknown,
  opts?: { requireAccountId?: string }
): Promise<CreatePaymentResult> {
  const raw = (rawBody ?? {}) as Record<string, unknown>;
  if (ordinaryPaymentAttachmentError(raw)) {
    return {
      ok: false,
      status: 400,
      message: "Payment attachments must be uploaded through the attachment endpoint",
    };
  }
  const processed = {
    ...raw,
    dateReceived: new Date(raw.dateReceived as string),
    dateCleared: raw.dateCleared ? new Date(raw.dateCleared as string) : undefined,
  };

  const validated = insertLedgerPaymentSchema.parse(processed);

  const allocValidation = validateProposedAllocation(
    validated.details as Record<string, unknown> | null,
    validated.amount,
  );
  if (!allocValidation.valid) {
    return { ok: false, status: 400, message: allocValidation.error || "Invalid allocation" };
  }

  const primaryEa = await storage.ledger.ea.get(validated.ledgerEaId);
  if (!primaryEa) {
    return { ok: false, status: 404, message: "EA entry not found" };
  }
  if (opts?.requireAccountId && primaryEa.accountId !== opts.requireAccountId) {
    return {
      ok: false,
      status: 400,
      message: "Selected participant belongs to a different account than this batch",
    };
  }

  if (allocValidation.allocations) {
    for (const alloc of allocValidation.allocations) {
      const allocEa = await storage.ledger.ea.get(alloc.eaId);
      if (!allocEa) {
        return {
          ok: false,
          status: 400,
          message: `Allocation references non-existent EA: ${alloc.eaId}`,
        };
      }
      if (opts?.requireAccountId && allocEa.accountId !== opts.requireAccountId) {
        return {
          ok: false,
          status: 400,
          message: "Allocation participant belongs to a different account than this batch",
        };
      }
      if (allocEa.accountId !== primaryEa.accountId) {
        return {
          ok: false,
          status: 400,
          message: "Allocation participant belongs to a different account than the payment",
        };
      }
    }
  }

  const uploadSourceValidation = await validateBaoUploadSource(
    validated.details as Record<string, unknown> | null,
    validated.amount,
    primaryEa,
  );
  if (!uploadSourceValidation.valid) {
    return { ok: false, status: 400, message: uploadSourceValidation.error || "Invalid upload source" };
  }

  const payment = await storage.ledger.payments.create(validated);
  return { ok: true, payment };
}

// Helper to check EA access inline after fetching the EA
async function checkPaymentEaAccessInline(req: Request, res: Response, ea: { entityType: string; entityId: string }, policyId: string): Promise<boolean> {
  const result = await checkAccessInline(req, policyId, ea.entityId, { entityType: ea.entityType, entityId: ea.entityId });
  if (!result.granted) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}

export async function triggerPaymentChargePlugins(payment: LedgerPayment): Promise<LedgerNotification[]> {
  try {
    const allNotifications: LedgerNotification[] = [];
    const expectedSimpleAllocationKeys = new Set<string>();
    const details = (payment.details || {}) as Record<string, unknown>;
    const proposedAllocation = details.proposedAllocation as Array<{ eaId: string; amount: string; statementYmd: string }> | undefined;

    if (proposedAllocation && proposedAllocation.length > 0) {
      for (const alloc of proposedAllocation) {
        const ea = await storage.ledger.ea.get(alloc.eaId);
        if (!ea) throw new Error(`Allocation EA not found: ${alloc.eaId}`);

        const allocIdentity = `${alloc.eaId}:${alloc.statementYmd || ""}`;
        const payload = {
          paymentId: payment.id,
          amount: alloc.amount,
          status: payment.status,
          ledgerEaId: alloc.eaId,
          accountId: ea.accountId,
          entityType: ea.entityType,
          entityId: ea.entityId,
          dateReceived: payment.dateReceived,
          dateCleared: payment.dateCleared,
          memo: payment.memo,
          paymentTypeId: payment.paymentType,
          allocationId: allocIdentity,
          allocationStatementYmd: alloc.statementYmd,
          details,
        };

        onAfterCommit(() => {
          eventBus.emit(EventType.PAYMENT_SAVED, payload).catch(err => {
            logger.error("Failed to emit PAYMENT_SAVED event for allocation", {
              service: "ledger-payments",
              paymentId: payment.id,
              ledgerEaId: alloc.eaId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        });

        const context: PaymentSavedContext = {
          trigger: TriggerType.PAYMENT_SAVED,
          ...payload,
        };

        const result = await executeChargePlugins(context, { throwOnFailure: true });
        allNotifications.push(...result.notifications);
        for (const transaction of result.totalTransactions) {
          if (transaction.chargePlugin === "payment-simple-allocation") {
            expectedSimpleAllocationKeys.add(transaction.chargePluginKey);
          }
        }
      }

      const allExistingEntries = await storage.ledger.entries.getByReference("payment", payment.id);
      for (const entry of allExistingEntries) {
        if (
          entry.chargePlugin === "payment-simple-allocation" &&
          entry.chargePluginKey &&
          !expectedSimpleAllocationKeys.has(entry.chargePluginKey)
        ) {
          await storage.ledger.entries.delete(entry.id);
          allNotifications.push({
            type: "deleted",
            amount: entry.amount,
            description: "Deleted stale allocation ledger entry",
          });
        }
      }
      return allNotifications;
    }

    const ea = await storage.ledger.ea.get(payment.ledgerEaId);
    if (!ea) {
      throw new Error(`Payment EA not found: ${payment.ledgerEaId}`);
    }

    const payload = {
      paymentId: payment.id,
      amount: payment.amount,
      status: payment.status,
      ledgerEaId: payment.ledgerEaId,
      accountId: ea.accountId,
      entityType: ea.entityType,
      entityId: ea.entityId,
      dateReceived: payment.dateReceived,
      dateCleared: payment.dateCleared,
      memo: payment.memo,
      paymentTypeId: payment.paymentType,
      details,
    };

    onAfterCommit(() => {
      eventBus.emit(EventType.PAYMENT_SAVED, payload).catch(err => {
        logger.error("Failed to emit PAYMENT_SAVED event", {
          service: "ledger-payments",
          paymentId: payment.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    const context: PaymentSavedContext = {
      trigger: TriggerType.PAYMENT_SAVED,
      ...payload,
    };

    const result = await executeChargePlugins(context, { throwOnFailure: true });
    allNotifications.push(...result.notifications);
    for (const transaction of result.totalTransactions) {
      if (transaction.chargePlugin === "payment-simple-allocation") {
        expectedSimpleAllocationKeys.add(transaction.chargePluginKey);
      }
    }

    const allExistingEntries = await storage.ledger.entries.getByReference("payment", payment.id);
    for (const entry of allExistingEntries) {
      if (
        entry.chargePlugin === "payment-simple-allocation" &&
        entry.chargePluginKey &&
        !expectedSimpleAllocationKeys.has(entry.chargePluginKey)
      ) {
        await storage.ledger.entries.delete(entry.id);
        allNotifications.push({
          type: "deleted",
          amount: entry.amount,
          description: "Deleted stale payment allocation ledger entry",
        });
      }
    }
    return allNotifications;
  } catch (error) {
    logger.error("Failed to execute charge plugins for payment", {
      service: "ledger-payments",
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function registerLedgerPaymentRoutes(app: Express) {
  // GET /api/ledger/payment-types - Get all payment types (available to all authenticated users for dropdowns)
  app.get("/api/ledger/payment-types", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const paymentTypes = await unifiedOptionsStorage.list("ledger-payment-type");
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment types" });
    }
  });

  // GET /api/ledger/payments/ea/:eaId - Get all payments for a specific EA entry
  app.get("/api/ledger/payments/ea/:eaId", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { eaId } = req.params;
      
      // Look up the EA to get entity info for access check
      const ea = await storage.ledger.ea.get(eaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;
      
      const payments = await storage.ledger.payments.getByLedgerEaId(eaId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // GET /api/ledger/accounts/:accountId/payments - Get all payments for a specific account with entity data
  app.get("/api/ledger/accounts/:accountId/payments", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const { accountId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      if (limit !== undefined && offset !== undefined) {
        const result = await storage.ledger.payments.getByAccountIdWithEntityPaginated(accountId, limit, offset);
        result.data = await enrichWithAllocatedEntities(result.data);
        res.json(result);
      } else {
        const payments = await storage.ledger.payments.getByAccountIdWithEntity(accountId);
        const enriched = await enrichWithAllocatedEntities(payments);
        res.json(enriched);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // GET /api/ledger/payments/:id - Get a specific payment
  app.get("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      const payment = await storage.ledger.payments.get(id);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      // Look up the EA to check access
      const ea = await storage.ledger.ea.get(payment.ledgerEaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;
      
      const [enriched] = await enrichWithAllocatedEntities([payment]);
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment" });
    }
  });

  // Attach one private raster image to an existing payment. The upload is
  // intentionally separate from payment writes so financial edits cannot
  // accidentally replace or clear an attachment.
  app.post(
    "/api/ledger/payments/:id/attachment",
    requireComponent("ledger"),
    requireAccess("staff"),
    paymentAttachmentUploadMiddleware,
    async (req, res) => {
      let uploadedObject: { id: string; fileSystemId: string; storagePath: string } | undefined;
      try {
        const payment = await storage.ledger.payments.get(req.params.id);
        if (!payment) {
          res.status(404).json({ message: "Payment not found" });
          return;
        }
        if (!req.file) {
          res.status(400).json({ message: "No image file provided" });
          return;
        }
        const attachmentError = validatePaymentAttachment(req.file);
        if (attachmentError) {
          res.status(400).json({ message: attachmentError });
          return;
        }
        if (!isFileSystemConfigured("private")) {
          res.status(503).json({ message: 'Filesystem "private" is not configured.' });
          return;
        }
        if (!req.user) {
          res.status(401).json({ message: "Authentication required" });
          return;
        }

        const uploaded = await fileSystemService.upload({
          fileSystemId: "private",
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
        });
        uploadedObject = {
          id: "uncommitted",
          fileSystemId: "private",
          storagePath: uploaded.storagePath,
        };
        const saved = await runInTransaction(async () => {
          const fileData = insertFileSchema.parse({
            fileName: req.file!.originalname,
            storagePath: uploaded.storagePath,
            mimeType: req.file!.mimetype,
            size: uploaded.size,
            uploadedBy: (req.user as any).id,
            entityType: "ledger_payment",
            entityId: payment.id,
            fileSystemId: "private",
            metadata: null,
          });
          const created = await storage.files.create(fileData);
          const replaced = await storage.ledger.payments.replaceAttachment(payment.id, created.id);
          if (!replaced) throw new Error("Payment not found");
          if (replaced.oldFile) schedulePaymentAttachmentCleanup(replaced.oldFile);
          return replaced.payment;
        });
        uploadedObject = undefined;
        res.status(201).json(saved);
      } catch (error) {
        // The object is written before the transaction starts. If validation,
        // file-row insertion, or payment replacement fails, the transaction
        // rolls back both database writes and only the raw object remains.
        if (uploadedObject) await removePaymentAttachmentObject(uploadedObject);
        if (error instanceof Error && error.name === "ZodError") {
          res.status(400).json({ message: "Invalid image attachment" });
        } else if (!res.headersSent) {
          res.status(500).json({ message: "Failed to save payment attachment" });
        }
      }
    },
  );

  app.delete(
    "/api/ledger/payments/:id/attachment",
    requireComponent("ledger"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const payment = await storage.ledger.payments.get(req.params.id);
        if (!payment) {
          res.status(404).json({ message: "Payment not found" });
          return;
        }
        await runInTransaction(async () => {
          const replaced = await storage.ledger.payments.replaceAttachment(payment.id, null);
          if (!replaced) throw new Error("Payment not found");
          if (replaced.oldFile) schedulePaymentAttachmentCleanup(replaced.oldFile);
        });
        res.status(204).send();
      } catch {
        res.status(500).json({ message: "Failed to remove payment attachment" });
      }
    },
  );

  // GET /api/ledger/payments/:id/transactions - Get ledger entries for a payment
  // (paginated, server-side filters; format=csv streams the full filtered set)
  app.get("/api/ledger/payments/:id/transactions", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;

      // First get the payment to find its EA
      const payment = await storage.ledger.payments.get(id);
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      // Look up the EA to check access
      const ea = await storage.ledger.ea.get(payment.ledgerEaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;

      await respondWithTransactions(req, res, { referenceType: "payment", referenceId: id }, "payment-transactions");
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to fetch payment transactions" });
      }
    }
  });

  // POST /api/ledger/payments - Create a new payment (staff only)
  app.post("/api/ledger/payments", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      if (ordinaryPaymentAttachmentError(req.body)) {
        res.status(400).json({ message: "Payment attachments must be uploaded through the attachment endpoint" });
        return;
      }
      const { result, notifications, enriched } = await runInTransaction(async () => {
        const result = await createPaymentFromRequestBody(req.body);
        if (!result.ok) {
          return {
            result,
            notifications: [] as LedgerNotification[],
            enriched: undefined,
          };
        }
        const notifications = await triggerPaymentChargePlugins(result.payment);
        const [enriched] = await enrichWithAllocatedEntities([result.payment]);
        return { result, notifications, enriched };
      });
      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }

      res.status(201).json({
        ...enriched!,
        ledgerNotifications: notifications,
      });
    } catch (error) {
      console.error("Error creating payment:", error);
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          message: "Invalid payment data", 
          error: error.message 
        });
      } else {
        res.status(500).json({ 
          message: "Failed to create payment", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }
  });

  // PUT /api/ledger/payments/:id - Update a payment (staff only)
  app.put("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const rawBody = req.body;
      if (ordinaryPaymentAttachmentError(rawBody)) {
        res.status(400).json({ message: "Payment attachments must be changed through the attachment endpoint" });
        return;
      }

      const processedBody = {
        ...rawBody,
        dateReceived: rawBody.dateReceived ? new Date(rawBody.dateReceived) : undefined,
        dateCleared: rawBody.dateCleared ? new Date(rawBody.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.partial().parse(processedBody);

      const { payment, notifications, enriched, batchIds, auditSummary } = await runInTransaction(async () => {
        const payment = await storage.ledger.payments.update(id, validatedData);
        if (!payment) {
          return {
            payment,
            notifications: [] as LedgerNotification[],
            enriched: undefined,
            batchIds: [] as string[],
            auditSummary: undefined,
          };
        }

        // Validate the complete row returned by UPDATE while its row lock and
        // this transaction are still active. A competing partial update can no
        // longer validate against stale amount/details and commit a mismatch.
        const details = payment.details as Record<string, unknown> | null;
        const allocValidation = validateProposedAllocation(details, payment.amount);
        if (!allocValidation.valid) {
          throw new PaymentStateValidationError(
            allocValidation.error || "Invalid allocation",
          );
        }

        const primaryEa = await storage.ledger.ea.get(payment.ledgerEaId);
        if (!primaryEa) {
          throw new PaymentStateValidationError("Payment EA not found");
        }
        const [account, paymentType] = await Promise.all([
          storage.ledger.accounts.get(primaryEa.accountId),
          unifiedOptionsStorage.get("ledger-payment-type", payment.paymentType),
        ]);
        if (!account) {
          throw new PaymentStateValidationError("Payment account not found");
        }
        if (!paymentType) {
          throw new PaymentStateValidationError("Payment type not found");
        }
        if (paymentType.currencyCode !== account.currencyCode) {
          throw new PaymentStateValidationError(
            `Payment type currency ${paymentType.currencyCode} does not match account currency ${account.currencyCode}`,
          );
        }
        for (const alloc of allocValidation.allocations ?? []) {
          const allocEa = await storage.ledger.ea.get(alloc.eaId);
          if (!allocEa) {
            throw new PaymentStateValidationError(
              `Allocation references non-existent EA: ${alloc.eaId}`,
            );
          }
          if (allocEa.accountId !== primaryEa.accountId) {
            throw new PaymentStateValidationError(
              "Allocation participant belongs to a different account than the payment",
            );
          }
        }

        const uploadSourceValidation = await validateBaoUploadSource(
          details,
          payment.amount,
          primaryEa,
          payment.id,
        );
        if (!uploadSourceValidation.valid) {
          throw new PaymentStateValidationError(
            uploadSourceValidation.error || "Invalid upload source",
          );
        }

        const notifications = await triggerPaymentChargePlugins(payment);
        const [enriched] = await enrichWithAllocatedEntities([payment]);
        const batchIds = await storage.ledger.paymentBatchAssignments.getBatchIdsByPaymentId(payment.id);
        const auditSummary = batchIds.length > 0
          ? await getPaymentAllocationAuditSummary(payment)
          : undefined;
        return { payment, notifications, enriched, batchIds, auditSummary };
      });
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      if (auditSummary) {
        const operation = payment.status === "cleared" ? "postPayment" : "updatePayment";
        for (const batchId of batchIds) {
          logBatchPaymentActivity(batchId, operation, auditSummary);
        }
      }
      res.json({
        ...enriched!,
        ledgerNotifications: notifications,
      });
    } catch (error) {
      console.error("Error updating payment:", error);
      if (error instanceof PaymentStateValidationError) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          message: "Invalid payment data", 
          error: error.message 
        });
      } else {
        res.status(500).json({ 
          message: "Failed to update payment", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }
  });

  // DELETE /api/ledger/payments/:id - Delete a payment (staff only)
  app.delete("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // First get the payment
      const payment = await storage.ledger.payments.get(id);
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }

      const success = await runInTransaction(async () => {
        await cleanupUploadSourcePaymentArtifacts(id, payment.details as Record<string, unknown> | null);
        const deleted = await storage.ledger.payments.delete(id);
        if (deleted && payment.attachmentFileId) {
          const file = await storage.files.getById(payment.attachmentFileId);
          if (file) {
            await storage.files.delete(file.id);
            schedulePaymentAttachmentCleanup(file);
          }
        }
        return deleted;
      });
      
      if (!success) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete payment" });
    }
  });
}

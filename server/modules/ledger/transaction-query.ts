import type { Request, Response } from "express";
import { stringify } from "csv-stringify/sync";
import { storage } from "../../storage";
import type { TransactionFilter, TransactionViewFilters, LedgerEntryWithDetails } from "../../storage/ledger";
import { buildContentDisposition } from "../../utils/content-disposition";
import { logger } from "../../logger";

/**
 * Shared handling for the paginated ledger transaction routes
 * (EA / account / payment / worker-hours views).
 *
 * - Parses the view filters (entity type/name, memo, amount range, date
 *   range) from query params so filtering happens server-side over the whole
 *   scoped dataset — pagination totals and pages reflect the filtered set.
 * - `format=csv` streams the ENTIRE filtered dataset in batches (no 100K
 *   cap); a mid-stream failure destroys the response so the download fails
 *   visibly instead of truncating silently.
 */

const MAX_PAGE_LIMIT = 200;
const EXPORT_BATCH = 10_000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const CSV_COLUMNS = [
  "Date",
  "Statement",
  "Amount",
  "Entity Type",
  "Entity Name",
  "Memo",
  "Reference Type",
  "Reference",
  "EA Account",
  "Transaction ID",
] as const;

function qstr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function parseTransactionViewFilters(req: Request): TransactionViewFilters | undefined {
  const q = req.query;
  const f: TransactionViewFilters = {};

  const entityType = qstr(q.entityType);
  if (entityType && entityType !== "all") f.entityType = entityType.slice(0, 100);
  const entityName = qstr(q.entityName);
  if (entityName) f.entityName = entityName.slice(0, 200);
  const memo = qstr(q.memo);
  if (memo) f.memo = memo.slice(0, 200);
  const amountMin = qstr(q.amountMin);
  if (amountMin && Number.isFinite(Number(amountMin))) f.amountMin = amountMin;
  const amountMax = qstr(q.amountMax);
  if (amountMax && Number.isFinite(Number(amountMax))) f.amountMax = amountMax;
  const dateFrom = qstr(q.dateFrom);
  if (dateFrom && YMD_RE.test(dateFrom)) f.dateFrom = new Date(`${dateFrom}T00:00:00.000Z`);
  const dateTo = qstr(q.dateTo);
  if (dateTo && YMD_RE.test(dateTo)) f.dateTo = new Date(`${dateTo}T23:59:59.999Z`);

  return Object.keys(f).length > 0 ? f : undefined;
}

export function transactionToCsvRecord(t: LedgerEntryWithDetails): Record<string, string> {
  return {
    Date: t.date ? new Date(t.date).toISOString().slice(0, 10) : "",
    Statement: t.statementYmd ? String(t.statementYmd).slice(0, 7) : "",
    Amount: Number.parseFloat(t.amount).toFixed(2),
    "Entity Type": t.entityType,
    "Entity Name": t.entityName || "",
    Memo: t.memo || "",
    "Reference Type": t.referenceType || "",
    Reference: t.referenceName || "",
    "EA Account": t.eaAccountName || "",
    "Transaction ID": t.id,
  };
}

function csvFilename(req: Request, fallbackBaseName: string): string {
  const requested = qstr(req.query.filename)?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const base = requested || fallbackBaseName;
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function startCsvResponse(res: Response, filename: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", buildContentDisposition("attachment", filename));
  res.write(stringify([], { header: true, columns: CSV_COLUMNS as unknown as string[] }));
}

/**
 * Handles a paginated transactions route for a storage-backed scope.
 * Access checks must already have passed. JSON responses include
 * `entityTypes` (distinct entity types across the whole scope) so filter
 * options are not limited to the current page.
 */
export async function respondWithTransactions(
  req: Request,
  res: Response,
  scope: TransactionFilter,
  fallbackCsvBaseName: string,
): Promise<void> {
  const viewFilters = parseTransactionViewFilters(req);

  if (req.query.format === "csv") {
    const filename = csvFilename(req, fallbackCsvBaseName);
    startCsvResponse(res, filename);
    try {
      let offset = 0;
      for (;;) {
        const { data } = await storage.ledger.entries.getTransactionsPaginated(
          scope, EXPORT_BATCH, offset, viewFilters, { skipCount: true },
        );
        if (data.length > 0) {
          res.write(stringify(data.map(transactionToCsvRecord), { header: false, columns: CSV_COLUMNS as unknown as string[] }));
        }
        offset += data.length;
        if (data.length < EXPORT_BATCH) break;
      }
      res.end();
    } catch (error) {
      logger.error("Ledger CSV export failed mid-stream", {
        service: "ledger-transaction-query",
        error: error instanceof Error ? error.message : String(error),
      });
      // Headers are already sent — abort the connection so the download
      // fails visibly instead of delivering a silently truncated file.
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }

  const limit = Math.min(Number.parseInt(req.query.limit as string) || 50, MAX_PAGE_LIMIT);
  const offset = Math.max(Number.parseInt(req.query.offset as string) || 0, 0);

  const [result, entityTypes] = await Promise.all([
    storage.ledger.entries.getTransactionsPaginated(scope, limit, offset, viewFilters),
    storage.ledger.entries.getTransactionEntityTypes(scope),
  ]);
  res.json({ ...result, entityTypes });
}

/**
 * In-memory equivalent of the storage-side view filters, for routes that
 * merge multiple small result sets (worker-hours transactions). Semantics
 * mirror the SQL path: case-insensitive substring for names/memo, inclusive
 * amount range, UTC-day-bounded date range.
 */
export function applyViewFiltersInMemory(
  rows: LedgerEntryWithDetails[],
  filters: TransactionViewFilters | undefined,
): LedgerEntryWithDetails[] {
  if (!filters) return rows;
  return rows.filter((t) => {
    if (filters.entityType && t.entityType !== filters.entityType) return false;
    if (filters.entityName && !(t.entityName || "").toLowerCase().includes(filters.entityName.toLowerCase())) return false;
    if (filters.memo && !(t.memo || "").toLowerCase().includes(filters.memo.toLowerCase())) return false;
    const amount = Number.parseFloat(t.amount);
    if (filters.amountMin !== undefined && !(amount >= Number(filters.amountMin))) return false;
    if (filters.amountMax !== undefined && !(amount <= Number(filters.amountMax))) return false;
    if (filters.dateFrom && !(t.date && new Date(t.date) >= filters.dateFrom)) return false;
    if (filters.dateTo && !(t.date && new Date(t.date) <= filters.dateTo)) return false;
    return true;
  });
}

/** CSV response for an already-materialized (small) row set. */
export function sendTransactionsCsvFromRows(
  req: Request,
  res: Response,
  rows: LedgerEntryWithDetails[],
  fallbackCsvBaseName: string,
): void {
  startCsvResponse(res, csvFilename(req, fallbackCsvBaseName));
  if (rows.length > 0) {
    res.write(stringify(rows.map(transactionToCsvRecord), { header: false, columns: CSV_COLUMNS as unknown as string[] }));
  }
  res.end();
}

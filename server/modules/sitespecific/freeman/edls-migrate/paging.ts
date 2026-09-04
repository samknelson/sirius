/**
 * Reading whole legacy tables, a page at a time.
 *
 * What the legacy service offers is narrow, and it decides the shape of this
 * module. Its data action runs exactly `select * from <table> order by <col>
 * limit <n> offset <m>`: no filtering, no count, no more-rows flag. So:
 *
 *  - Every filter is applied here, after the rows arrive. The caller says what
 *    to keep; the reader just walks.
 *
 *  - Paging ends when a page comes back short. That is the ONLY end signal,
 *    which is why a refusal must never be mistaken for one: a page that failed
 *    is also a page with no rows, and treating it as the end would quietly
 *    stage a fraction of the table as though it were all of it. Every read
 *    therefore reports how it stopped, and only "complete" means the whole
 *    table was seen.
 *
 *  - An unknown table name comes back as an HTTP 500, and a query the service
 *    dislikes can come back as a 200 whose inner envelope says it failed. Both
 *    are refusals here.
 *
 * A page cap bounds the walk: a table far larger than expected stops rather
 * than paging forever, and says so.
 */
import {
  freemanEdlsMigrateRequest,
  type FreemanEdlsMigrateRequestSpec,
  type FreemanEdlsMigrateResult,
} from "./client";

/** The legacy action that returns raw table rows. */
export const FREEMAN_EDLS_MIGRATE_RAWDATA_ACTION = "sirius_freeman_rawdata";

/** Rows per request. The legacy tables are small enough that this is cheap. */
export const FREEMAN_EDLS_MIGRATE_PAGE_SIZE = 500;

/**
 * Most pages one table read may take. The largest table involved (the node
 * table) is tens of thousands of rows; this leaves generous headroom while
 * still ending a runaway walk.
 */
export const FREEMAN_EDLS_MIGRATE_MAX_PAGES = 200;

/** One legacy row, as fetched: column name to value, nothing interpreted. */
export type LegacyRow = Record<string, unknown>;

/**
 * A raw-data request. The arguments are positional — table, order column,
 * limit, offset — and the service ignores anything after them.
 */
export function buildRawDataRequest(
  table: string,
  orderColumn: string,
  limit: number,
  offset: number,
): FreemanEdlsMigrateRequestSpec {
  return {
    action: FREEMAN_EDLS_MIGRATE_RAWDATA_ACTION,
    args: [table, orderColumn, String(limit), String(offset)],
  };
}

export interface LegacyPage {
  /** True only when the service returned a row list for this page. */
  ok: boolean;
  rows: LegacyRow[];
  /** The full diagnostic result, kept for the failure report. */
  result: FreemanEdlsMigrateResult;
  /** Why the page is not usable, when it is not. */
  error?: string;
}

/**
 * The rows live inside the envelope's own `data`, which carries its own
 * success flag alongside the SQL the service ran. A body that does not carry
 * a row list is a failure, not an empty page.
 */
export function extractPageRows(result: FreemanEdlsMigrateResult): LegacyPage {
  if (!result.success) {
    return { ok: false, rows: [], result, error: result.error ?? "The legacy system refused the request." };
  }
  const inner = (result.data as { data?: unknown } | undefined)?.data;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    return {
      ok: false,
      rows: [],
      result,
      error: "The legacy system answered without a data section.",
    };
  }
  const section = inner as { success?: unknown; records?: unknown };
  // The data section always states its own success as a boolean. Anything
  // else — false, missing, some other encoding — is a refusal: an answer we
  // cannot read is not an answer that the query succeeded.
  if (section.success !== true) {
    return {
      ok: false,
      rows: [],
      result,
      error:
        section.success === false
          ? "The legacy system reported the query itself failed."
          : "The legacy system answered without saying whether the query succeeded.",
    };
  }
  if (!Array.isArray(section.records)) {
    return {
      ok: false,
      rows: [],
      result,
      error: "The legacy system answered without a row list.",
    };
  }
  // Every member must be a row. Dropping the ones that are not would shorten
  // the page, and a short page is how this reader learns the table ended —
  // one unreadable member would silently truncate the whole walk.
  const rows: LegacyRow[] = [];
  for (const record of section.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return {
        ok: false,
        rows: [],
        result,
        error: "The legacy system returned something that is not a row.",
      };
    }
    rows.push(record as LegacyRow);
  }
  return { ok: true, rows, result };
}

/** Fetch one page of a legacy table. */
export async function fetchLegacyPage(
  table: string,
  orderColumn: string,
  limit: number,
  offset: number,
): Promise<LegacyPage> {
  const result = await freemanEdlsMigrateRequest(
    buildRawDataRequest(table, orderColumn, limit, offset),
  );
  return extractPageRows(result);
}

/**
 * How a table read ended.
 *  - `complete`: a short page arrived, so the whole table was seen.
 *  - `page_cap`: the cap was hit first; what was read is a prefix, not the table.
 *  - `refused`: a page failed; everything after it is unknown.
 */
export type LegacyReadStop = "complete" | "page_cap" | "refused";

export interface LegacyTableRead {
  table: string;
  stoppedBecause: LegacyReadStop;
  /** True only for `complete`. */
  complete: boolean;
  pages: number;
  /** Rows the legacy system returned, before the caller's filter. */
  rowsRead: number;
  /** Rows the caller kept. */
  rowsKept: number;
  /** Set when the read was refused. */
  error?: string;
  /** The failing page's diagnostics, for the admin screen. */
  failure?: FreemanEdlsMigrateResult;
}

export interface ReadLegacyTableOptions {
  table: string;
  /** Column to order by; paging is only stable if this is unique-ish. */
  orderColumn: string;
  pageSize?: number;
  maxPages?: number;
  /**
   * Called with each page's rows. Returning how many were kept lets the report
   * say what the filter did; returning nothing counts them all as kept.
   */
  onRows: (rows: LegacyRow[]) => number | void | Promise<number | void>;
}

/** Walk one legacy table to its end (or to the first refusal). */
export async function readLegacyTable(
  options: ReadLegacyTableOptions,
): Promise<LegacyTableRead> {
  const pageSize = options.pageSize ?? FREEMAN_EDLS_MIGRATE_PAGE_SIZE;
  const maxPages = options.maxPages ?? FREEMAN_EDLS_MIGRATE_MAX_PAGES;

  let pages = 0;
  let rowsRead = 0;
  let rowsKept = 0;

  while (pages < maxPages) {
    const page = await fetchLegacyPage(
      options.table,
      options.orderColumn,
      pageSize,
      pages * pageSize,
    );
    pages += 1;

    if (!page.ok) {
      return {
        table: options.table,
        stoppedBecause: "refused",
        complete: false,
        pages,
        rowsRead,
        rowsKept,
        error: page.error,
        failure: page.result,
      };
    }

    rowsRead += page.rows.length;
    const kept = await options.onRows(page.rows);
    rowsKept += typeof kept === "number" ? kept : page.rows.length;

    // A short page is the end of the table — the only end signal there is.
    if (page.rows.length < pageSize) {
      return {
        table: options.table,
        stoppedBecause: "complete",
        complete: true,
        pages,
        rowsRead,
        rowsKept,
      };
    }
  }

  return {
    table: options.table,
    stoppedBecause: "page_cap",
    complete: false,
    pages,
    rowsRead,
    rowsKept,
    error: `Stopped after the ${maxPages}-page limit; the table has more rows than expected.`,
  };
}

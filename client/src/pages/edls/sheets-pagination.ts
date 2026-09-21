export const EDLS_SHEETS_PAGE_SIZE = 100;

export interface SheetsPaginationSummary {
  rangeStart: number;
  rangeEnd: number;
  totalPages: number;
  currentPage: number;
}

export function getSheetsPaginationSummary(
  page: number,
  pageSize: number,
  total: number,
  rowCount: number,
): SheetsPaginationSummary {
  if (total === 0) {
    return { rangeStart: 0, rangeEnd: 0, totalPages: 1, currentPage: 1 };
  }

  const totalPages = Math.ceil(total / pageSize);
  return {
    rangeStart: page * pageSize + 1,
    rangeEnd: Math.min(page * pageSize + rowCount, total),
    totalPages,
    currentPage: page + 1,
  };
}

export function buildSheetsQueryString(
  page: number,
  filters: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(EDLS_SHEETS_PAGE_SIZE),
  });

  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }

  return params.toString();
}

export function getPreviousSheetsPage(page: number): number {
  return Math.max(0, page - 1);
}

export function getNextSheetsPage(page: number, totalPages: number): number {
  return Math.min(Math.max(0, totalPages - 1), page + 1);
}

export function getValidSheetsPage(page: number, total: number): number {
  const lastPage = Math.max(0, Math.ceil(total / EDLS_SHEETS_PAGE_SIZE) - 1);
  return Math.min(page, lastPage);
}
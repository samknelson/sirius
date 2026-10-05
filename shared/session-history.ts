import { z } from "zod";

export const SESSION_HISTORY_PAGE_SIZES = [10, 25, 50, 100] as const;
export const sessionHistoryPagingSchema = z.object({
  // Keep offsets within PostgreSQL's integer range, even at maximum page size.
  page: z.number().int().min(1).max(21_474_836).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export interface UserSessionHistoryEntry {
  id: string;
  timestamp: string;
  ip: string | null;
  sessionReference: string;
}

export interface UserSessionHistoryPage {
  entries: UserSessionHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

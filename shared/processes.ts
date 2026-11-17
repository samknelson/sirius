import { z } from "zod";

export const PROCESS_STALE_MS = 3 * 60_000;
export function processReportingStatus(updatedTs: string | Date, now = Date.now()): "Reporting" | "Stale" {
  return now - new Date(updatedTs).getTime() <= PROCESS_STALE_MS ? "Reporting" : "Stale";
}
export const processPagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export interface ProcessListEntry {
  id: string;
  name: string | null;
  roles: string[];
  startedTs: string;
  updatedTs: string;
  status: "Reporting" | "Stale";
}
export interface ProcessPage {
  entries: ProcessListEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
